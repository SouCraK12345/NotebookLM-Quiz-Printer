const sheet = document.getElementById("sheet");
const printButton = document.getElementById("print");
const toggleAnswersButton = document.getElementById("toggleAnswers");

printButton.addEventListener("click", () => window.print());
toggleAnswersButton.addEventListener("click", () => {
  document.body.classList.toggle("hidden-answers");
});

init();

async function init() {
  const { latestQuizPrintData } = await chrome.storage.local.get("latestQuizPrintData");
  if (!latestQuizPrintData?.quiz?.length) {
    sheet.textContent = "No quiz data found. Run the extension from a NotebookLM quiz page first.";
    return;
  }

  const { quiz, options, sourceTitle } = latestQuizPrintData;
  document.title = options.title || "Worksheet";
  if (!options.includeRationales) document.body.classList.add("hidden-answers");

  sheet.append(
    renderHeader(options.title || "Worksheet", sourceTitle),
    ...quiz.map((question, index) => renderQuestion(question, index, options))
  );

  if (options.includeRationales) sheet.append(renderAnswerKey(quiz));
}

function renderHeader(title, sourceTitle) {
  const header = el("header", "print-header");
  header.append(el("h1", "", title));
  if (sourceTitle) header.append(el("p", "source-title", sourceTitle));
  return header;
}

function renderQuestion(question, index, options) {
  const section = el("section", "question");
  const title = el("div", "question-title");
  title.append(el("span", "", `${index + 1}.`), el("span", "", question.question));

  const choices = el("ol", "choices");
  question.answerOptions.forEach((option, optionIndex) => {
    const item = el("li", "choice");
    item.append(el("span", "", choiceLabel(optionIndex)), el("span", "", option.text));
    choices.append(item);
  });

  section.append(title, choices);

  if (options.includeHints && question.hint) {
    section.append(el("p", "hint", `Hint: ${question.hint}`));
  }

  return section;
}

function renderAnswerKey(quiz) {
  const section = el("section", "answer-key");
  const list = el("div", "answer-list");
  section.append(el("h2", "", "解答"), list);

  quiz.forEach((question, index) => {
    const correct = question.answerOptions.find((option) => option.isCorrect);
    const item = el("div", "answer-item");
    item.append(el("strong", "", `${index + 1}. ${correct?.text || "Unknown"}`));
    if (correct?.rationale) item.append(el("p", "rationale", correct.rationale));
    list.append(item);
  });

  return section;
}

function choiceLabel(index) {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

function el(tagName, className = "", text = "") {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
