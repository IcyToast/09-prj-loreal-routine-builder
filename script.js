/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const featuredProductPanel = document.getElementById("featuredProductPanel");
const directionAutoBtn = document.getElementById("directionAutoBtn");
const directionLtrBtn = document.getElementById("directionLtrBtn");
const directionRtlBtn = document.getElementById("directionRtlBtn");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const selectedProductsSection = document.querySelector(".selected-products");
const generateRoutineBtn = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");
const workerURL = "https://openaiworker.kkeh14.workers.dev/";
const chatStorageKey = "lorealChatConversation";
const INITIAL_DOCUMENT_LANG = (
  document.documentElement.lang || ""
).toLowerCase();
const RTL_LANGUAGE_PREFIXES = [
  "ar",
  "fa",
  "he",
  "ur",
  "ps",
  "sd",
  "ug",
  "yi",
  "dv",
  "ckb",
  "ku",
];

/* Conversation state for Chat Completions */
const messages = [
  {
    role: "system",
    content:
      "You are a friendly L'Oreal beauty assistant for beginners. Give short, simple answers using plain language and easy step-by-step advice. Use the user's selected products when building routines, and do not include products they did not select unless the user asks. Keep the tone warm and encouraging. If you are not sure about something, say that clearly and suggest a safe next step. Do not use markdown formatting like **bold**. Only respond to questions about the generated routine, skincare, haircare, makeup, fragrance, other related areas, do not answer to any other questions. Use names a appropriate amount if stated. Use only the selected products for the routine amd if its too much products, suggest that they remove it and explain why",
  },
];

/* Save current chat (without the system message) so refresh keeps history. */
function saveConversation() {
  const conversationOnly = messages.filter((msg) => msg.role !== "system");
  localStorage.setItem(chatStorageKey, JSON.stringify(conversationOnly));
}

/* Load every saved user/assistant message so full chat history survives refresh. */
function loadConversation() {
  const raw = localStorage.getItem(chatStorageKey);

  if (!raw) {
    return;
  }

  try {
    const savedMessages = JSON.parse(raw);

    if (!Array.isArray(savedMessages)) {
      return;
    }

    savedMessages.forEach((msg) => {
      if (
        msg &&
        (msg.role === "user" || msg.role === "assistant") &&
        typeof msg.content === "string"
      ) {
        messages.push(msg);
      }
    });
  } catch (error) {
    console.error("Could not load saved conversation", error);
  }
}

/* Keep track of all products and the user's selected products */
let allProducts = [];
let selectedProducts = [];
let removedProductsHistory = [];
let activeCategory = "";
let activeSearchTerm = "";
let featuredProductId = null;

const SELECTED_PRODUCTS_STORAGE_KEY = "lorealSelectedProducts";
const UNDO_HISTORY_LIMIT = 5;

generateRoutineBtn.insertAdjacentHTML(
  "beforebegin",
  `
    <div class="selection-actions">
      <button id="removeAllBtn" class="remove-all-btn" type="button" hidden>
        Remove All
      </button>
      <button id="undoRemoveBtn" class="undo-btn" type="button" hidden>
        Undo Remove
      </button>
    </div>
  `,
);

const removeAllBtn = document.getElementById("removeAllBtn");
const undoRemoveBtn = document.getElementById("undoRemoveBtn");

chatForm.insertAdjacentHTML(
  "afterend",
  `
    <button id="clearChatBtn" class="clear-chat-btn" type="button">
      Clear Chat
    </button>
  `,
);

const clearChatBtn = document.getElementById("clearChatBtn");

/* Escape HTML so user text is displayed safely in chat output. */
function escapeHTML(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* Remove markdown bold markers so chat stays plain and readable. */
function removeBoldMarkdown(text) {
  return text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*\*/g, "");
}

function isRTLLanguageTag(languageTag) {
  if (typeof languageTag !== "string" || languageTag.trim() === "") {
    return false;
  }

  const normalizedTag = languageTag.toLowerCase();

  return RTL_LANGUAGE_PREFIXES.some(
    (prefix) =>
      normalizedTag === prefix || normalizedTag.startsWith(`${prefix}-`),
  );
}

function hasRTLCharacters(text) {
  if (typeof text !== "string") {
    return false;
  }

  return /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
}

function canAutoSetDirection() {
  const htmlElement = document.documentElement;
  const mode = htmlElement.dataset.directionMode || "auto";

  if (mode !== "auto") {
    return false;
  }

  if (!htmlElement.hasAttribute("dir")) {
    return true;
  }

  return htmlElement.dataset.autoDirection === "true";
}

function setDocumentDirection(direction, force = false) {
  if (!force && !canAutoSetDirection()) {
    return;
  }

  const normalizedDirection = direction === "rtl" ? "rtl" : "ltr";

  if (
    document.documentElement.getAttribute("dir") === normalizedDirection &&
    (!document.body ||
      document.body.getAttribute("dir") === normalizedDirection)
  ) {
    document.documentElement.dataset.autoDirection = "true";
    return;
  }

  document.documentElement.setAttribute("dir", normalizedDirection);
  document.documentElement.dataset.autoDirection = "true";

  if (document.body) {
    document.body.setAttribute("dir", normalizedDirection);
  }
}

function updateDirectionButtonState(mode) {
  directionAutoBtn.classList.toggle("active", mode === "auto");
  directionLtrBtn.classList.toggle("active", mode === "ltr");
  directionRtlBtn.classList.toggle("active", mode === "rtl");
}

function setDirectionMode(mode) {
  const htmlElement = document.documentElement;
  const safeMode = ["auto", "ltr", "rtl"].includes(mode) ? mode : "auto";

  htmlElement.dataset.directionMode = safeMode;
  updateDirectionButtonState(safeMode);

  if (safeMode === "auto") {
    refreshDirectionFromInputs();
    return;
  }

  setDocumentDirection(safeMode, true);
}

/* Auto-apply direction from detected language when no explicit dir is set. */
function applyDirectionFromLanguage() {
  if (!canAutoSetDirection()) {
    return;
  }

  const htmlElement = document.documentElement;

  const shouldUseRTL =
    isRTLLanguageTag(htmlElement.lang) || isRTLLanguageTag(navigator.language);

  setDocumentDirection(shouldUseRTL ? "rtl" : "ltr");
}

/* Detect direction after external page translation (e.g. Google Translate). */
function getTranslatedDirectionSignal() {
  const htmlElement = document.documentElement;
  const bodyElement = document.body;
  const htmlClasses = htmlElement.classList;
  const bodyClasses = bodyElement ? bodyElement.classList : null;

  if (
    htmlClasses.contains("translated-rtl") ||
    (bodyClasses && bodyClasses.contains("translated-rtl"))
  ) {
    return "rtl";
  }

  if (
    htmlClasses.contains("translated-ltr") ||
    (bodyClasses && bodyClasses.contains("translated-ltr"))
  ) {
    return "ltr";
  }

  const currentLang = (htmlElement.lang || "").toLowerCase();

  if (currentLang && currentLang !== INITIAL_DOCUMENT_LANG) {
    return isRTLLanguageTag(currentLang) ? "rtl" : "ltr";
  }

  return null;
}

/* Switch direction live when users type in RTL scripts. */
function updateDirectionFromText(text) {
  if (typeof text !== "string" || text.trim() === "") {
    return;
  }

  setDocumentDirection(hasRTLCharacters(text) ? "rtl" : "ltr");
}

/* Recompute direction from current input text, then fallback to language. */
function refreshDirectionFromInputs() {
  if (!canAutoSetDirection()) {
    return;
  }

  const translatedDirection = getTranslatedDirectionSignal();

  if (translatedDirection) {
    setDocumentDirection(translatedDirection);
    return;
  }

  const htmlLang = (document.documentElement.lang || "").toLowerCase();
  const bodyLang = (document.body?.lang || "").toLowerCase();
  const browserLang = (navigator.language || "").toLowerCase();

  const shouldUseRTL =
    isRTLLanguageTag(htmlLang) ||
    isRTLLanguageTag(bodyLang) ||
    isRTLLanguageTag(browserLang);

  setDocumentDirection(shouldUseRTL ? "rtl" : "ltr");
}

function observeDirectionSignals() {
  const observer = new MutationObserver(() => {
    refreshDirectionFromInputs();
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang", "dir", "class"],
  });

  if (document.body) {
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["lang", "dir", "class"],
    });
  }
}

/* Rebuild the chat window from saved conversation messages. */
function renderConversation() {
  refreshDirectionFromInputs();

  const conversationOnly = messages.filter((msg) => msg.role !== "system");

  if (conversationOnly.length === 0) {
    chatWindow.innerHTML =
      '<p class="chat-empty">Ask a question or generate a routine from your selected products.</p>';
    return;
  }

  chatWindow.innerHTML = conversationOnly
    .map((msg) => {
      const sender = msg.role === "user" ? "You" : "L'Oréal Advisor";
      const plainText =
        msg.role === "assistant"
          ? removeBoldMarkdown(msg.content)
          : msg.content;
      const safeContent = escapeHTML(plainText).replace(/\n/g, "<br>");
      const roleClass =
        msg.role === "user" ? "chat-message-user" : "chat-message-assistant";

      return `
        <div class="chat-message ${roleClass}">
          <p class="chat-message-label">${sender}</p>
          <p class="chat-message-text">${safeContent}</p>
        </div>
      `;
    })
    .join("");

  chatWindow.scrollTop = chatWindow.scrollHeight;
}

/* Send a chat-completions request and return reply text + finish reason. */
async function requestAssistantCompletion(requestMessages) {
  const hasDirectKey =
    typeof OPENAI_API_KEY === "string" && OPENAI_API_KEY.trim() !== "";

  const endpoint = hasDirectKey
    ? "https://api.openai.com/v1/chat/completions"
    : workerURL;

  const headers = {
    "Content-Type": "application/json",
  };

  if (hasDirectKey) {
    headers.Authorization = `Bearer ${OPENAI_API_KEY}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "gpt-4o",
      messages: requestMessages,
    }),
  });

  if (!response.ok) {
    throw new Error("OpenAI request failed.");
  }

  const data = await response.json();
  const firstChoice = data?.choices?.[0];
  const assistantText = firstChoice?.message?.content;
  const finishReason = firstChoice?.finish_reason;

  if (!assistantText) {
    throw new Error("No assistant response was returned.");
  }

  return {
    assistantText,
    finishReason,
  };
}

/* Send current messages to OpenAI and return assistant text. */
async function getAssistantReply() {
  const firstReply = await requestAssistantCompletion(messages);

  if (firstReply.finishReason !== "length") {
    return firstReply.assistantText;
  }

  /* If the first response is cut off, request one continuation. */
  try {
    const continuationMessages = [
      ...messages,
      { role: "assistant", content: firstReply.assistantText },
      {
        role: "user",
        content:
          "Please continue from exactly where you stopped. Do not repeat previous text.",
      },
    ];

    const continuationReply = await requestAssistantCompletion(
      continuationMessages,
    );

    return `${firstReply.assistantText}\n${continuationReply.assistantText}`.trim();
  } catch (error) {
    return `${firstReply.assistantText}\n\n(Reply may be shortened.)`;
  }
}

/* Add user message, call OpenAI, then add assistant message. */
async function sendMessageToAssistant(userMessage) {
  messages.push({ role: "user", content: userMessage });
  saveConversation();
  renderConversation();

  try {
    const assistantText = removeBoldMarkdown(await getAssistantReply());
    messages.push({ role: "assistant", content: assistantText });
    saveConversation();
    renderConversation();
  } catch (error) {
    messages.push({
      role: "assistant",
      content:
        "I could not reach the API right now. Please check your worker/API setup and try again.",
    });
    saveConversation();
    renderConversation();
  }
}

/* Clear saved chat and keep only the system instruction in memory. */
function clearConversation() {
  messages.splice(1);
  localStorage.removeItem(chatStorageKey);
  renderConversation();
}

function saveSelectedProductsToStorage() {
  localStorage.setItem(
    SELECTED_PRODUCTS_STORAGE_KEY,
    JSON.stringify(selectedProducts),
  );
}

function loadSelectedProductsFromStorage() {
  const savedProductsText = localStorage.getItem(SELECTED_PRODUCTS_STORAGE_KEY);

  if (!savedProductsText) {
    return;
  }

  try {
    const savedProducts = JSON.parse(savedProductsText);

    if (Array.isArray(savedProducts)) {
      selectedProducts = savedProducts;
    }
  } catch (error) {
    console.warn("Could not read saved selected products.", error);
  }
}

function addRemovedProductToHistory(product, index) {
  removedProductsHistory.push({ product, index });

  if (removedProductsHistory.length > UNDO_HISTORY_LIMIT) {
    removedProductsHistory.shift();
  }
}

function updateUndoButtonVisibility() {
  undoRemoveBtn.hidden = removedProductsHistory.length === 0;
}

function updateRemoveAllButtonVisibility() {
  removeAllBtn.hidden = selectedProducts.length === 0;
}

function syncVisibleCardSelection(productId, shouldBeSelected) {
  const card = productsContainer.querySelector(
    `[data-product-id="${productId}"]`,
  );

  if (!card) {
    return;
  }

  if (shouldBeSelected) {
    card.classList.add("selected");
    card.setAttribute("aria-pressed", "true");
  } else {
    card.classList.remove("selected");
    card.setAttribute("aria-pressed", "false");
  }
}

function toggleProductSelection(productId) {
  const product = allProducts.find((item) => item.id === productId);

  if (!product) {
    return;
  }

  const selectedIndex = selectedProducts.findIndex(
    (item) => item.id === productId,
  );

  if (selectedIndex === -1) {
    selectedProducts.push(product);
    syncVisibleCardSelection(productId, true);
  } else {
    addRemovedProductToHistory(selectedProducts[selectedIndex], selectedIndex);
    selectedProducts.splice(selectedIndex, 1);
    syncVisibleCardSelection(productId, false);
  }

  saveSelectedProductsToStorage();
  renderSelectedProducts();

  if (!featuredProductPanel.hidden && featuredProductId === productId) {
    renderFeaturedProduct(product);
  }
}

/* Show initial placeholder until user selects a category */
productsContainer.innerHTML = `
  <div class="placeholder-message">
    Loading products...
  </div>
`;

/* Load product data from JSON file */
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  return data.products;
}

/* Show selected products in the "Selected Products" section */
function renderSelectedProducts() {
  if (selectedProducts.length === 0) {
    selectedProductsList.innerHTML = "<p>No products selected yet.</p>";
    updateUndoButtonVisibility();
    updateRemoveAllButtonVisibility();
    return;
  }

  selectedProductsList.innerHTML = selectedProducts
    .map(
      (product) => `
      <div class="selected-product-pill">
        <span>${product.name}</span>
        <button
          class="remove-selected-btn"
          type="button"
          data-product-id="${product.id}"
          aria-label="Remove ${product.name}"
        >
          &times;
        </button>
      </div>
    `,
    )
    .join("");

  updateUndoButtonVisibility();
  updateRemoveAllButtonVisibility();
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  if (products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        No matching products found. Try another keyword or category.
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = products
    .map((product) => {
      const isSelected = selectedProducts.some(
        (item) => item.id === product.id,
      );

      return `
    <div
      class="product-card ${isSelected ? "selected" : ""}"
      data-product-id="${product.id}"
      role="button"
      tabindex="0"
      aria-pressed="${isSelected}"
      aria-label="${product.name} by ${product.brand}. Press to ${
        isSelected ? "remove" : "select"
      }"
    >
      <div class="product-media">
        <img src="${product.image}" alt="${product.name}">
        <button class="learn-more-btn" type="button" data-product-id="${product.id}">
          Learn More
        </button>
      </div>
      <div class="product-info">
        <h3>${product.name}</h3>
        <p>${product.brand}</p>
      </div>
    </div>
  `;
    })
    .join("");
}

function renderFeaturedProduct(product) {
  if (!product) {
    featuredProductPanel.hidden = true;
    featuredProductPanel.classList.remove("selected");
    featuredProductPanel.innerHTML = "";
    return;
  }

  const isSelected = selectedProducts.some((item) => item.id === product.id);
  featuredProductPanel.classList.toggle("selected", isSelected);

  featuredProductPanel.innerHTML = `
    <div
      class="featured-product-content ${isSelected ? "selected" : ""}"
      data-product-id="${product.id}"
      role="button"
      tabindex="0"
      aria-pressed="${isSelected}"
      aria-label="${isSelected ? "Deselect" : "Select"} ${product.name}"
    >
      <div class="featured-product-image-wrap">
        <img src="${product.image}" alt="${product.name}">
      </div>
      <div class="featured-product-details">
        <p class="featured-product-brand">${product.brand}</p>
        <h3>${product.name}</h3>
        <p class="featured-product-description">${product.description}</p>
      </div>
    </div>
  `;

  featuredProductPanel.hidden = false;
}

function getFilteredProducts() {
  return allProducts.filter((product) => {
    const matchesCategory =
      activeCategory === "" || product.category === activeCategory;

    const normalizedText =
      `${product.name} ${product.brand} ${product.category} ${product.description}`.toLowerCase();
    const matchesSearch =
      activeSearchTerm === "" || normalizedText.includes(activeSearchTerm);

    return matchesCategory && matchesSearch;
  });
}

function renderFilteredProducts() {
  const filteredProducts = getFilteredProducts();
  const featuredProduct = filteredProducts.find(
    (product) => product.id === featuredProductId,
  );

  renderFeaturedProduct(featuredProduct || null);
  displayProducts(filteredProducts);
}

/* Toggle a product when a card is clicked */
productsContainer.addEventListener("click", (e) => {
  const learnMoreBtn = e.target.closest(".learn-more-btn");

  if (learnMoreBtn) {
    const productId = Number(learnMoreBtn.dataset.productId);
    const product = allProducts.find((item) => item.id === productId);

    if (!product) {
      return;
    }

    featuredProductId = productId;
    renderFeaturedProduct(product);
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  const card = e.target.closest(".product-card");

  if (!card) {
    return;
  }

  const productId = Number(card.dataset.productId);
  toggleProductSelection(productId);
});

/* Let users toggle product selection from the full featured product box. */
featuredProductPanel.addEventListener("click", (e) => {
  const featuredContent = e.target.closest(".featured-product-content");

  if (!featuredContent) {
    return;
  }

  const productId = Number(featuredContent.dataset.productId);
  toggleProductSelection(productId);
});

/* Keep featured-box selection keyboard accessible. */
featuredProductPanel.addEventListener("keydown", (e) => {
  const isActivateKey = e.key === "Enter" || e.key === " ";

  if (!isActivateKey) {
    return;
  }

  const featuredContent = e.target.closest(".featured-product-content");

  if (!featuredContent) {
    return;
  }

  e.preventDefault();
  const productId = Number(featuredContent.dataset.productId);
  toggleProductSelection(productId);
});

/* Allow keyboard users to select/remove cards with Enter or Space. */
productsContainer.addEventListener("keydown", (e) => {
  if (e.target.closest(".learn-more-btn")) {
    return;
  }

  const isActivateKey = e.key === "Enter" || e.key === " ";

  if (!isActivateKey) {
    return;
  }

  const card = e.target.closest(".product-card");

  if (!card) {
    return;
  }

  e.preventDefault();
  card.click();
});

/* Remove a selected product when x is clicked */
selectedProductsList.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".remove-selected-btn");

  if (!removeBtn) {
    return;
  }

  const productId = Number(removeBtn.dataset.productId);
  const selectedIndex = selectedProducts.findIndex(
    (item) => item.id === productId,
  );

  if (selectedIndex === -1) {
    return;
  }

  addRemovedProductToHistory(selectedProducts[selectedIndex], selectedIndex);
  const removedProduct = selectedProducts[selectedIndex];
  selectedProducts.splice(selectedIndex, 1);

  syncVisibleCardSelection(productId, false);
  saveSelectedProductsToStorage();
  renderSelectedProducts();

  if (!featuredProductPanel.hidden && featuredProductId === removedProduct.id) {
    renderFeaturedProduct(removedProduct);
  }
});

/* Restore the most recently removed selected product */
undoRemoveBtn.addEventListener("click", () => {
  if (removedProductsHistory.length === 0) {
    updateUndoButtonVisibility();
    return;
  }

  const lastRemovedEntry = removedProductsHistory.pop();
  const { product, index } = lastRemovedEntry;

  const alreadySelected = selectedProducts.some(
    (item) => item.id === product.id,
  );

  if (!alreadySelected) {
    const safeIndex = Math.min(index, selectedProducts.length);
    selectedProducts.splice(safeIndex, 0, product);
    syncVisibleCardSelection(product.id, true);
  }

  saveSelectedProductsToStorage();
  renderSelectedProducts();

  if (!featuredProductPanel.hidden && featuredProductId === product.id) {
    renderFeaturedProduct(product);
  }
});

/* Remove all selected products at once. */
removeAllBtn.addEventListener("click", () => {
  if (selectedProducts.length === 0) {
    return;
  }

  selectedProducts.forEach((product, index) => {
    addRemovedProductToHistory(product, index);
  });

  selectedProducts = [];
  const visibleProductCards =
    productsContainer.querySelectorAll(".product-card");

  visibleProductCards.forEach((card) => {
    card.classList.remove("selected");
    card.setAttribute("aria-pressed", "false");
  });

  saveSelectedProductsToStorage();
  renderSelectedProducts();

  if (!featuredProductPanel.hidden && featuredProductId !== null) {
    const featuredProduct = allProducts.find(
      (item) => item.id === featuredProductId,
    );

    if (featuredProduct) {
      renderFeaturedProduct(featuredProduct);
    }
  }
});

/* Generate a routine using selected products and OpenAI. */
generateRoutineBtn.addEventListener("click", async () => {
  if (selectedProducts.length === 0) {
    chatWindow.innerHTML = "Please select at least one product first.";
    return;
  }

  const selectedItemsText = selectedProducts
    .map(
      (product, index) =>
        `${index + 1}. ${product.brand} - ${product.name} (${product.category})`,
    )
    .join("\n");

  const routinePrompt = `Create a beginner-friendly morning and evening routine using ONLY these selected products:\n${selectedItemsText}\n\nFor each step, include: product name, when to use it, and one short tip. Keep the answer clear and concise.`;

  generateRoutineBtn.disabled = true;
  generateRoutineBtn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';

  await sendMessageToAssistant(routinePrompt);

  generateRoutineBtn.disabled = false;
  generateRoutineBtn.innerHTML =
    '<i class="fa-solid fa-wand-magic-sparkles"></i> Generate Routine';
});

/* Keep product list synced with category selection. */
categoryFilter.addEventListener("change", (e) => {
  activeCategory = e.target.value;
  featuredProductId = null;
  renderFilteredProducts();
});

/* Live search by product name, brand, category, or keywords in description. */
productSearch.addEventListener("input", (e) => {
  const searchText = e.target.value.trim();
  activeSearchTerm = searchText.toLowerCase();
  featuredProductId = null;
  refreshDirectionFromInputs();
  renderFilteredProducts();
});

/* Update layout direction while the user types in chat. */
userInput.addEventListener("input", () => {
  refreshDirectionFromInputs();
});

async function initializeProducts() {
  allProducts = await loadProducts();
  renderFilteredProducts();
}

/* Render empty selected area on first page load */
applyDirectionFromLanguage();
loadConversation();
loadSelectedProductsFromStorage();
updateUndoButtonVisibility();
updateRemoveAllButtonVisibility();
renderSelectedProducts();
renderConversation();
initializeProducts();
refreshDirectionFromInputs();
setDirectionMode("auto");
observeDirectionSignals();

directionAutoBtn.addEventListener("click", () => {
  setDirectionMode("auto");
});

directionLtrBtn.addEventListener("click", () => {
  setDirectionMode("ltr");
});

directionRtlBtn.addEventListener("click", () => {
  setDirectionMode("rtl");
});

/* Send free-text questions to OpenAI from the chat input. */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const promptText = userInput.value.trim();

  if (!promptText) {
    return;
  }

  refreshDirectionFromInputs();

  userInput.value = "";
  await sendMessageToAssistant(promptText);
});

clearChatBtn.addEventListener("click", () => {
  clearConversation();
});
