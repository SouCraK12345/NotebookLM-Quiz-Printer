const createButton = document.getElementById("create");
const statusNode = document.getElementById("status");

createButton.addEventListener("click", async () => {
  setBusy(true, "Extracting...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("Could not read the current tab.");

    let injectionResults;
    try {
      injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: extractNotebookLmQuiz
      });
    } catch {
      injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractNotebookLmQuiz
      });
    }

    const result = injectionResults.map((item) => item.result).find((item) => item?.ok);
    if (!result?.ok) {
      const debug = injectionResults.map((item) => item.result?.debug).filter(Boolean).join(" | ");
      throw new Error(`Quiz data was not found. ${debug || "No app data candidates were found."}`);
    }

    const options = {
      title: document.getElementById("title").value.trim() || "Worksheet",
      includeHints: document.getElementById("includeHints").checked,
      includeRationales: document.getElementById("includeRationales").checked
    };

    await chrome.storage.local.set({
      latestQuizPrintData: {
        createdAt: new Date().toISOString(),
        sourceTitle: tab.title || "",
        quiz: result.quiz,
        topics: result.topics || null,
        options
      }
    });

    await chrome.tabs.create({ url: chrome.runtime.getURL("print.html") });
    setBusy(false, `Loaded ${result.quiz.length} questions.`);
  } catch (error) {
    setBusy(false, error.message);
  }
});

function setBusy(isBusy, message) {
  createButton.disabled = isBusy;
  statusNode.textContent = message || "";
}

async function extractNotebookLmQuiz() {
  const rawCandidates = [];
  const notes = [];

  addDocumentCandidates(document, "current document");

  for (const frame of document.querySelectorAll("iframe, frame")) {
    try {
      if (frame.contentDocument) addDocumentCandidates(frame.contentDocument, "child frame");
    } catch (error) {
      notes.push(`unreadable frame: ${error.name}`);
    }
  }

  const initial = findQuizInCandidates(rawCandidates);
  if (initial?.ok) return initial;

  const blobUrls = collectBlobUrls();
  for (const url of blobUrls) {
    try {
      const response = await fetch(url);
      const html = await response.text();
      rawCandidates.push(html);
      const parsed = new DOMParser().parseFromString(html, "text/html");
      addDocumentCandidates(parsed, `blob html ${url.slice(0, 70)}`);
      const found = findQuizInCandidates(rawCandidates);
      if (found?.ok) return found;
    } catch (error) {
      notes.push(`blob fetch failed: ${error.name}`);
    }
  }

  const debug = [
    `checked ${rawCandidates.length} candidates`,
    `blob urls ${blobUrls.length}`,
    ...notes.slice(0, 3)
  ].join(", ");
  return { ok: false, debug };

  function addDocumentCandidates(doc, label) {
    const appRoots = [...doc.querySelectorAll("app-root, [data-app-data]")];
    notes.push(`${label}: ${appRoots.length} app roots/data nodes`);

    for (const root of appRoots) {
      rawCandidates.push(root.dataset?.appData);
      rawCandidates.push(root.getAttribute("data-app-data"));
      for (const attr of root.getAttributeNames()) {
        if (/app|data|quiz|state|props|initial/i.test(attr)) rawCandidates.push(root.getAttribute(attr));
      }
    }

    for (const script of doc.querySelectorAll('script[type="application/json"], script:not([src])')) {
      const text = script.textContent?.trim();
      if (text && /quiz|answerOptions|appData|data-app-data/i.test(text)) rawCandidates.push(text);
    }

    rawCandidates.push(doc.body?.innerText);
    rawCandidates.push(doc.documentElement?.outerHTML);
  }

  function collectBlobUrls() {
    const urls = new Set();
    for (const entry of performance.getEntriesByType("resource")) {
      if (entry.name?.startsWith("blob:")) urls.add(entry.name);
    }

    const urlPattern = /blob:https:\/\/[^\s"'<>]+/g;
    for (const html of [document.documentElement?.outerHTML || "", document.body?.innerText || ""]) {
      for (const match of html.matchAll(urlPattern)) urls.add(match[0]);
    }

    for (const element of document.querySelectorAll("[src], [href]")) {
      const value = element.getAttribute("src") || element.getAttribute("href") || "";
      if (value.startsWith("blob:")) urls.add(value);
    }

    return [...urls];
  }
  function findQuizInCandidates(candidates) {
    const seen = new Set();
    const queue = candidates.filter(Boolean).map((value) => ({ value, depth: 0 }));

    while (queue.length) {
      const { value, depth } = queue.shift();
      if (depth > 10 || value == null) continue;

      const key = typeof value === "string" ? `${value.length}:${value.slice(0, 800)}` : value;
      if (seen.has(key)) continue;
      seen.add(key);

      const direct = normalizeQuizPayload(value);
      if (direct?.quiz?.length) {
        const quiz = direct.quiz.map(normalizeQuestion).filter(Boolean);
        if (quiz.length) return { ok: true, quiz, topics: direct.topics || null };
      }

      if (typeof value === "string") {
        for (const parsed of parseStringVariants(value)) queue.push({ value: parsed, depth: depth + 1 });
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) queue.push({ value: item, depth: depth + 1 });
        continue;
      }

      if (typeof value === "object") {
        for (const item of Object.values(value)) queue.push({ value: item, depth: depth + 1 });
      }
    }

    return null;
  }

  function normalizeQuizPayload(value) {
    if (!value || typeof value !== "object") return null;
    if (Array.isArray(value.quiz)) return value;

    const quizLikeKey = Object.keys(value).find((key) => key.toLowerCase() === "quiz");
    if (quizLikeKey && Array.isArray(value[quizLikeKey])) {
      return { quiz: value[quizLikeKey], topics: value.topics };
    }

    return null;
  }

  function parseStringVariants(input) {
    const variants = new Set([input, input.trim()]);
    const trimmed = input.trim();

    if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      variants.add(trimmed.slice(1, -1));
    }

    variants.add(htmlDecode(input));
    variants.add(input.replace(/\\n/g, "\n").replace(/\\"/g, '"'));
    variants.add(htmlDecode(input).replace(/\\n/g, "\n").replace(/\\"/g, '"'));

    for (const source of [...variants]) {
      const jsonMatch = source.match(/\{[\s\S]*"quiz"[\s\S]*\}/);
      if (jsonMatch) variants.add(jsonMatch[0]);
    }

    const parsed = [];
    for (const variant of variants) {
      try {
        parsed.push(JSON.parse(variant));
      } catch {
        const repaired = variant
          .replace(/^'\s*/, "")
          .replace(/\s*'$/, "")
          .replace(/\\n/g, "\n")
          .replace(/\\"/g, '"');
        try {
          parsed.push(JSON.parse(repaired));
        } catch {
          if (repaired.includes('"quiz"')) parsed.push(repaired);
        }
      }
    }
    return parsed;
  }

  function htmlDecode(text) {
    if (!/[&][a-z#0-9]+;/i.test(text)) return text;
    const textarea = document.createElement("textarea");
    textarea.innerHTML = text;
    return textarea.value;
  }

  function normalizeQuestion(item, index) {
    if (!item || typeof item !== "object") return null;

    const answerOptions = Array.isArray(item.answerOptions)
      ? item.answerOptions
      : Array.isArray(item.answers)
        ? item.answers
        : Array.isArray(item.options)
          ? item.options
          : [];

    return {
      question: repairMojibake(String(item.question || item.prompt || `Question ${index + 1}`)),
      hint: item.hint ? repairMojibake(String(item.hint)) : "",
      answerOptions: answerOptions.map((option) => ({
        text: repairMojibake(String(option.text || option.answer || option.label || "")),
        isCorrect: Boolean(option.isCorrect || option.correct),
        rationale: option.rationale ? repairMojibake(String(option.rationale)) : ""
      }))
    };
  }

  function repairMojibake(text) {
    if (!looksLikeJapaneseMojibake(text)) return text;
    try {
      const binary = Array.from(text, (char) => `%${(char.charCodeAt(0) & 0xff).toString(16).padStart(2, "0")}`).join("");
      const decoded = decodeURIComponent(binary);
      return decoded && decoded.length >= Math.ceil(text.length / 3) ? decoded : text;
    } catch {
      return text;
    }
  }

  function looksLikeJapaneseMojibake(text) {
    const markers = [0x7e3a, 0x7e67, 0x8b41, 0x8b5b, 0x8711, 0x87df, 0x8373, 0x838a, 0xfffd];
    let hits = 0;
    for (const char of text) {
      if (markers.includes(char.charCodeAt(0))) hits += 1;
      if (hits >= 2) return true;
    }
    return false;
  }
}


