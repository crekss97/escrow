import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";
import deployments from "./deployments.json";
import "./styles.css";

const ETHERSCAN_BASE = "https://sepolia.etherscan.io";
const WALLET_SESSION_KEY = "escrowWalletSessionUntil";
const WALLET_SESSION_MS = 30 * 60 * 1000;
const purchaseStatus = ["Fondeada", "Completada", "Cancelada"];

const marketplaceAbi = [
  "function publishProduct(string title,string description,uint256 price) external returns (uint256)",
  "function setProductActive(uint256 productId,bool active) external",
  "function deleteProduct(uint256 productId) external",
  "function getProduct(uint256 productId) external view returns (address seller,uint256 price,string title,string description,bool active,bool deleted)",
  "function getPurchase(uint256 purchaseId) external view returns (uint256 productId,address seller,address buyer,uint256 price,uint8 status)",
  "function nextProductId() external view returns (uint256)",
  "function nextPurchaseId() external view returns (uint256)",
  "event ProductPublished(uint256 indexed productId,address indexed seller,uint256 price,string title,string description)",
  "event ProductStatusChanged(uint256 indexed productId,bool active)",
  "event ProductDeleted(uint256 indexed productId)",
  "event PurchaseCreated(uint256 indexed purchaseId,uint256 indexed productId,address indexed buyer,address seller,uint256 price)",
  "event PurchaseCompleted(uint256 indexed purchaseId)",
  "event PurchaseCancelled(uint256 indexed purchaseId)"
];

const vaultAbi = [
  "function buyProduct(uint256 productId) external payable returns (uint256)",
  "function confirmReceipt(uint256 purchaseId) external",
  "function refundBuyer(uint256 purchaseId) external",
  "function deposits(uint256 purchaseId) external view returns (uint256)",
  "function vaultBalance() external view returns (uint256)",
  "event PurchaseFunded(uint256 indexed purchaseId,uint256 indexed productId,address indexed buyer,address seller,uint256 amount)",
  "event ReceiptConfirmed(uint256 indexed purchaseId,address indexed buyer,address indexed seller,uint256 amount)",
  "event PurchaseRefunded(uint256 indexed purchaseId,address indexed buyer,uint256 amount)"
];

const state = {
  provider: null,
  signer: null,
  marketplace: null,
  vault: null,
  account: "",
  view: "buyer",
  sellerMode: "publish",
  productFilter: "available",
  products: [],
  purchases: [],
  txs: []
};

document.querySelector("#app").innerHTML = `
  <main class="shell">
    <section class="hero compact-hero">
      <div class="hero-copy">
        <p class="eyebrow">Escrow TP · Sepolia</p>
        <h1>Marketplace con custodia on-chain</h1>
        <p class="subtitle">Publica productos, compra con escrow y consulta evidencia sin salir de la app.</p>
      </div>
      <aside class="hero-panel" aria-label="Estado de conexion">
        <div class="wallet-row"><span class="status-dot"></span><p>Wallet</p></div>
        <strong id="walletLabel">No conectada</strong>
        <button id="connectWallet">Conectar / cambiar cuenta</button>
      </aside>
    </section>

    <section class="metrics" aria-label="Saldos operativos">
      <article><span>Mi balance</span><strong id="accountBalance">-</strong></article>
      <article><span>Custodiado en vault</span><strong id="vaultBalance">-</strong></article>
    </section>

    <nav class="view-tabs" aria-label="Cambiar perfil">
      <button id="buyerTab" class="tab active">Vista comprador</button>
      <button id="sellerTab" class="tab">Vista vendedor</button>
      <button id="activityTab" class="tab">Actividad y logs</button>
      <button id="refreshData" class="tab ghost">Actualizar datos</button>
    </nav>

    <section class="evidence-strip" aria-label="Evidencia Etherscan">
      <a id="marketplaceLink" target="_blank" rel="noreferrer">Marketplace verificado</a>
      <a id="vaultLink" target="_blank" rel="noreferrer">EscrowVault verificado</a>
      <a id="accountLink" target="_blank" rel="noreferrer">Mi cuenta en Etherscan</a>
    </section>

    <section id="buyerView" class="workspace">
      <div class="section-heading">
        <p class="eyebrow dark">Comprador</p>
        <h2>Elegir una publicacion</h2>
        <p>Comprar crea una compra y deposita el precio exacto en EscrowVault en una sola transaccion.</p>
      </div>
      <div class="filter-bar" aria-label="Filtrar publicaciones">
        <button class="filter active" data-filter="available">Disponibles</button>
        <button class="filter" data-filter="mine">Publicadas por mi</button>
        <button class="filter" data-filter="bought">Ya compradas</button>
        <button class="filter" data-filter="paused">Pausadas</button>
        <button class="filter" data-filter="deleted">Eliminadas</button>
        <button class="filter" data-filter="all">Todas</button>
      </div>
      <div id="productGrid" class="product-grid"></div>

      <article class="card ledger-card">
        <h3>Gestionar mi compra</h3>
        <div class="form-grid">
          <label>ID de compra <input id="purchaseId" placeholder="1" /></label>
          <button id="loadPurchase" class="secondary">Consultar compra</button>
          <button id="confirmReceipt">Confirmar recepcion</button>
          <button id="refundBuyer" class="danger">Cancelar y reembolsar</button>
        </div>
      </article>
    </section>

    <section id="sellerView" class="workspace hidden">
      <div class="section-heading">
        <p class="eyebrow dark">Vendedor</p>
        <h2>Publicar producto</h2>
        <p>La publicacion queda disponible para que cualquier comprador la fondee desde la vista comprador.</p>
      </div>
      <div class="sub-tabs" aria-label="Opciones vendedor">
        <button id="sellerPublishTab" class="tab active">Publicar producto</button>
        <button id="sellerPublishedTab" class="tab">Publicado</button>
      </div>
      <article id="sellerPublishPanel" class="card publish-card">
        <label>Titulo <input id="productTitle" aria-describedby="titleHelp" /></label>
        <small id="titleHelp">Nombre corto y claro del producto publicado.</small>
        <label>Precio en ETH <input id="productPrice" inputmode="decimal" aria-describedby="priceHelp" /></label>
        <small id="priceHelp">Ejemplo recomendado para pruebas: 0.001 o 0.002 ETH.</small>
        <label>Descripcion <textarea id="productDescription" aria-describedby="descriptionHelp"></textarea></label>
        <small id="descriptionHelp">Inclui estado del producto, condiciones de entrega y cualquier detalle relevante.</small>
        <button id="publishProduct">Publicar producto</button>
      </article>
      <section id="sellerPublishedPanel" class="hidden seller-products-panel">
        <div class="product-grid" id="sellerProductGrid"></div>
      </section>
      <article id="sellerAdminPanel" class="card ledger-card hidden">
        <h3>Administrar publicacion</h3>
        <div class="form-grid">
          <label>ID de producto <input id="sellerProductId" placeholder="1" /></label>
          <button id="pauseProduct" class="secondary">Pausar</button>
          <button id="activateProduct">Reactivar</button>
          <button id="deleteProduct" class="danger">Eliminar</button>
        </div>
      </article>
    </section>

    <section id="activityView" class="log-card hidden">
      <div>
        <p class="eyebrow dark">Actividad</p>
        <h2>Transacciones y logs</h2>
        <p>Historial operativo de la sesion, con accesos directos a Etherscan.</p>
      </div>
      <div id="txList" class="tx-list"></div>
      <pre id="log">Listo para operar.</pre>
    </section>
  </main>

  <dialog id="confirmModal" class="modal">
    <form method="dialog">
      <p class="eyebrow dark">Confirmacion requerida</p>
      <h2 id="modalTitle">Confirmar accion</h2>
      <p id="modalBody">Revisa los datos antes de abrir MetaMask.</p>
      <div class="modal-actions">
        <button id="cancelModal" value="cancel" class="secondary">Cancelar</button>
        <button id="acceptModal" value="confirm">Confirmar</button>
      </div>
    </form>
  </dialog>

  <dialog id="purchaseModal" class="modal purchase-modal">
    <form method="dialog">
      <p class="eyebrow dark">Detalle de compra</p>
      <h2 id="purchaseModalTitle">Compra</h2>
      <div id="purchaseModalBody" class="purchase-modal-body"></div>
      <div class="modal-actions">
        <button value="close">Cerrar</button>
      </div>
    </form>
  </dialog>
`;

const elements = {
  walletLabel: document.querySelector("#walletLabel"),
  buyerView: document.querySelector("#buyerView"),
  sellerView: document.querySelector("#sellerView"),
  activityView: document.querySelector("#activityView"),
  sellerPublishPanel: document.querySelector("#sellerPublishPanel"),
  sellerPublishedPanel: document.querySelector("#sellerPublishedPanel"),
  sellerAdminPanel: document.querySelector("#sellerAdminPanel"),
  buyerTab: document.querySelector("#buyerTab"),
  sellerTab: document.querySelector("#sellerTab"),
  activityTab: document.querySelector("#activityTab"),
  sellerPublishTab: document.querySelector("#sellerPublishTab"),
  sellerPublishedTab: document.querySelector("#sellerPublishedTab"),
  productGrid: document.querySelector("#productGrid"),
  sellerProductGrid: document.querySelector("#sellerProductGrid"),
  purchaseModal: document.querySelector("#purchaseModal"),
  purchaseModalTitle: document.querySelector("#purchaseModalTitle"),
  purchaseModalBody: document.querySelector("#purchaseModalBody"),
  accountBalance: document.querySelector("#accountBalance"),
  vaultBalance: document.querySelector("#vaultBalance"),
  txList: document.querySelector("#txList"),
  log: document.querySelector("#log"),
  modal: document.querySelector("#confirmModal"),
  modalTitle: document.querySelector("#modalTitle"),
  modalBody: document.querySelector("#modalBody")
};

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "No disponible";
}

function log(message) {
  elements.log.textContent = `${new Date().toLocaleTimeString()} - ${message}\n${elements.log.textContent}`;
}

function etherscanAddress(address) {
  return `${ETHERSCAN_BASE}/address/${address}`;
}

function etherscanTx(hash) {
  return `${ETHERSCAN_BASE}/tx/${hash}`;
}

function updateLinks() {
  document.querySelector("#marketplaceLink").href = etherscanAddress(deployments.marketplace);
  document.querySelector("#vaultLink").href = etherscanAddress(deployments.escrowVault);
  document.querySelector("#accountLink").href = state.account ? etherscanAddress(state.account) : ETHERSCAN_BASE;
}

function renderTxs() {
  elements.txList.innerHTML = state.txs.length
    ? state.txs.map((tx) => `<a target="_blank" rel="noreferrer" href="${etherscanTx(tx.hash)}">${tx.label}: ${shortAddress(tx.hash)}</a>`).join("")
    : `<span class="muted">Las transacciones apareceran aca automaticamente.</span>`;
}

function switchView(view) {
  if (state.view === "seller" && view !== "seller") clearSellerForm();
  state.view = view;
  elements.buyerView.classList.toggle("hidden", view !== "buyer");
  elements.sellerView.classList.toggle("hidden", view !== "seller");
  elements.activityView.classList.toggle("hidden", view !== "activity");
  elements.buyerTab.classList.toggle("active", view === "buyer");
  elements.sellerTab.classList.toggle("active", view === "seller");
  elements.activityTab.classList.toggle("active", view === "activity");
}

function switchSellerMode(mode) {
  state.sellerMode = mode;
  elements.sellerPublishPanel.classList.toggle("hidden", mode !== "publish");
  elements.sellerPublishedPanel.classList.toggle("hidden", mode !== "published");
  elements.sellerAdminPanel.classList.toggle("hidden", mode !== "published");
  elements.sellerPublishTab.classList.toggle("active", mode === "publish");
  elements.sellerPublishedTab.classList.toggle("active", mode === "published");
  if (mode === "published") renderSellerProducts();
}

function clearSellerForm() {
  document.querySelector("#productTitle").value = "";
  document.querySelector("#productPrice").value = "";
  document.querySelector("#productDescription").value = "";
}

function getProductPurchase(productId) {
  return state.purchases.find((purchase) => purchase.productId === productId && purchase.status !== 2);
}

function getOwnPurchase(productId) {
  return state.purchases.find((purchase) => (
    purchase.productId === productId
    && purchase.buyer.toLowerCase() === state.account.toLowerCase()
    && purchase.status !== 2
  ));
}

function confirmAction(title, body) {
  elements.modalTitle.textContent = title;
  elements.modalBody.textContent = body;
  elements.modal.showModal();

  return new Promise((resolve) => {
    elements.modal.addEventListener("close", () => resolve(elements.modal.returnValue === "confirm"), { once: true });
  });
}

async function connectContracts() {
  state.marketplace = new Contract(deployments.marketplace, marketplaceAbi, state.signer);
  state.vault = new Contract(deployments.escrowVault, vaultAbi, state.signer);
}

async function syncActiveAccount() {
  if (!state.provider) return;

  state.signer = await state.provider.getSigner();
  state.account = await state.signer.getAddress();
  await connectContracts();
  elements.walletLabel.textContent = shortAddress(state.account);
  updateLinks();
  await refreshBalances();
}

async function connectWallet(forceAccountPicker = false) {
  if (!window.ethereum) throw new Error("MetaMask no esta instalado.");
  state.provider = new BrowserProvider(window.ethereum);
  if (forceAccountPicker && window.ethereum.request) {
    await window.ethereum.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  }
  await state.provider.send("eth_requestAccounts", []);
  await syncActiveAccount();
  localStorage.setItem(WALLET_SESSION_KEY, String(Date.now() + WALLET_SESSION_MS));
  log(`Wallet conectada: ${state.account}`);
}

async function restoreWalletSession() {
  if (!window.ethereum) return;
  const sessionUntil = Number(localStorage.getItem(WALLET_SESSION_KEY) || 0);
  if (!sessionUntil || Date.now() > sessionUntil) {
    localStorage.removeItem(WALLET_SESSION_KEY);
    return;
  }

  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  if (!accounts.length) return;
  state.provider = new BrowserProvider(window.ethereum);
  await syncActiveAccount();
  await refreshProducts();
  log("Sesion de wallet restaurada temporalmente.");
}

async function refreshBalances() {
  if (!state.provider || !state.vault || !state.account) return;
  const [accountBalance, vaultBalance] = await Promise.all([
    state.provider.getBalance(state.account),
    state.vault.vaultBalance()
  ]);
  elements.accountBalance.textContent = `${Number(formatEther(accountBalance)).toFixed(5)} ETH`;
  elements.vaultBalance.textContent = `${Number(formatEther(vaultBalance)).toFixed(5)} ETH`;
}

async function ensureReady() {
  if (!state.signer) await connectWallet();
  await syncActiveAccount();
}

async function trackTx(label, tx) {
  state.txs.unshift({ label, hash: tx.hash });
  renderTxs();
  log(`${label}. Tx enviada: ${tx.hash}`);
  const receipt = await tx.wait();
  log(`${label}. Confirmada en bloque ${receipt.blockNumber}. Actualizando datos de la app...`);
  await refreshBalances();
  return receipt;
}

function findEvent(receipt, contract, eventName) {
  return receipt.logs.map((item) => {
    try {
      return contract.interface.parseLog(item);
    } catch {
      return null;
    }
  }).find((event) => event?.name === eventName);
}

async function refreshProducts() {
  await ensureReady();
  const [nextProductId, nextPurchaseId] = await Promise.all([
    state.marketplace.nextProductId(),
    state.marketplace.nextPurchaseId()
  ]);
  const products = [];
  const purchases = [];

  for (let id = 1n; id < nextProductId; id += 1n) {
    try {
      const product = await state.marketplace.getProduct(id);
      products.push({
        id,
        seller: product.seller,
        price: product.price,
        title: product.title,
        description: product.description,
        active: product.active,
        deleted: product.deleted
      });
    } catch {
      // Ignora IDs inexistentes si el contrato cambia en futuras pruebas.
    }
  }

  for (let id = 1n; id < nextPurchaseId; id += 1n) {
    try {
      const purchase = await state.marketplace.getPurchase(id);
      purchases.push({
        id,
        productId: purchase.productId,
        seller: purchase.seller,
        buyer: purchase.buyer,
        price: purchase.price,
        status: Number(purchase.status)
      });
    } catch {
      // Ignora IDs inexistentes si el contrato cambia en futuras pruebas.
    }
  }

  state.products = products;
  state.purchases = purchases;
  renderProducts();
  renderSellerProducts();
  await refreshBalances();
}

async function loadPurchaseIntoPanel(purchaseId) {
  const purchase = await state.marketplace.getPurchase(purchaseId);
  const deposit = await state.vault.deposits(purchaseId);
  const status = Number(purchase.status);
  elements.purchaseModalTitle.textContent = `Compra #${purchaseId}`;
  elements.purchaseModalBody.innerHTML = `
    <div class="purchase-status ${status === 1 ? "complete" : ""}">
      <span>${purchaseStatus[status]}</span>
      <strong>${status === 1 ? "Producto recibido y pago liberado" : status === 2 ? "Compra cancelada" : "ETH custodiado en EscrowVault"}</strong>
    </div>
    <dl>
      <div><dt>Producto</dt><dd>#${purchase.productId}</dd></div>
      <div><dt>Precio</dt><dd>${formatEther(purchase.price)} ETH</dd></div>
      <div><dt>Depositado</dt><dd>${formatEther(deposit)} ETH</dd></div>
      <div><dt>Vendedor</dt><dd><a target="_blank" rel="noreferrer" href="${etherscanAddress(purchase.seller)}">${purchase.seller}</a></dd></div>
      <div><dt>Comprador</dt><dd><a target="_blank" rel="noreferrer" href="${etherscanAddress(purchase.buyer)}">${purchase.buyer}</a></dd></div>
    </dl>
  `;

  if (elements.purchaseModal.open) elements.purchaseModal.close();
  elements.purchaseModal.showModal();
}

async function waitForPurchaseStatus(purchaseId, expectedStatus) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const purchase = await state.marketplace.getPurchase(purchaseId);
    if (Number(purchase.status) === expectedStatus) return purchase;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  return state.marketplace.getPurchase(purchaseId);
}

function renderProducts() {
  const visibleProducts = state.products.filter((product) => {
    const ownPurchase = getOwnPurchase(product.id);
    const isOwnProduct = product.seller.toLowerCase() === state.account.toLowerCase();

    if (state.productFilter === "available") return product.active && !product.deleted && !ownPurchase && !isOwnProduct;
    if (state.productFilter === "mine") return isOwnProduct && !product.deleted;
    if (state.productFilter === "bought") return Boolean(ownPurchase);
    if (state.productFilter === "paused") return !product.active && !product.deleted;
    if (state.productFilter === "deleted") return product.deleted;
    return true;
  });

  if (!visibleProducts.length) {
    const emptyMessages = {
      available: "No hay publicaciones disponibles para comprar con la cuenta actual.",
      mine: "Esta cuenta todavia no publico productos activos.",
      bought: "Esta cuenta todavia no tiene compras iniciadas.",
      paused: "No hay publicaciones pausadas.",
      deleted: "No hay publicaciones eliminadas.",
      all: "Todavia no hay productos publicados."
    };
    elements.productGrid.innerHTML = `<p class="empty-message">${emptyMessages[state.productFilter]}</p>`;
    return;
  }

  elements.productGrid.innerHTML = visibleProducts.map((product) => {
    const ownPurchase = getOwnPurchase(product.id);
    const isOwnProduct = product.seller.toLowerCase() === state.account.toLowerCase();
    const canBuy = product.active && !product.deleted && !ownPurchase && !isOwnProduct;
    const boughtLabel = ownPurchase?.status === 1 ? `Completada (#${ownPurchase.id})` : `Ya comprada (#${ownPurchase?.id})`;
    const statusText = product.deleted ? "Eliminada" : !product.active ? "Pausada" : ownPurchase ? boughtLabel : isOwnProduct ? "Tu publicacion" : "Activa";

    return `
    <article class="product-card ${canBuy ? "" : "disabled"}">
      <div class="product-topline">
        <span>#${product.id}</span>
        <strong>${statusText}</strong>
      </div>
      <h3>${product.title}</h3>
      <p>${product.description}</p>
      <div class="price-row">
        <span>${formatEther(product.price)} ETH</span>
        <a target="_blank" rel="noreferrer" href="${etherscanAddress(product.seller)}">Vendedor ${shortAddress(product.seller)}</a>
      </div>
      <button data-buy="${product.id}" ${canBuy ? "" : "disabled"}>${ownPurchase?.status === 1 ? "Compra completada" : ownPurchase ? "Compra ya iniciada" : "Comprar con escrow"}</button>
    </article>
  `;
  }).join("");
}

function renderSellerProducts() {
  if (!elements.sellerProductGrid) return;
  const ownProducts = state.products.filter((product) => product.seller.toLowerCase() === state.account.toLowerCase());

  if (!ownProducts.length) {
    elements.sellerProductGrid.innerHTML = `<p class="empty-message">Todavia no publicaste productos con esta cuenta.</p>`;
    return;
  }

  elements.sellerProductGrid.innerHTML = ownProducts.map((product) => {
    const purchase = getProductPurchase(product.id);
    const statusText = product.deleted
      ? "Eliminada"
      : purchase?.status === 1
        ? `Vendida y completada (#${purchase.id})`
        : purchase
          ? `Comprada en escrow (#${purchase.id})`
          : product.active ? "Publicada" : "Pausada";

    return `
      <article class="product-card seller-card ${product.deleted ? "disabled" : ""}">
        <div class="product-topline">
          <span>#${product.id}</span>
          <strong>${statusText}</strong>
        </div>
        <h3>${product.title}</h3>
        <p>${product.description}</p>
        <div class="price-row">
          <span>${formatEther(product.price)} ETH</span>
          ${purchase ? `<a target="_blank" rel="noreferrer" href="${etherscanAddress(purchase.buyer)}">Comprador ${shortAddress(purchase.buyer)}</a>` : `<span>Sin comprador</span>`}
        </div>
      </article>
    `;
  }).join("");
}

async function run(action) {
  try {
    await ensureReady();
    await action();
  } catch (error) {
    log(error.shortMessage || error.message);
  }
}

document.querySelector("#connectWallet").addEventListener("click", async () => {
  try {
    await connectWallet(true);
    await refreshProducts();
  } catch (error) {
    log(error.shortMessage || error.message);
  }
});
document.querySelector("#buyerTab").addEventListener("click", () => switchView("buyer"));
document.querySelector("#sellerTab").addEventListener("click", () => switchView("seller"));
document.querySelector("#activityTab").addEventListener("click", () => switchView("activity"));
document.querySelector("#refreshData").addEventListener("click", () => run(refreshProducts));
document.querySelector("#sellerPublishTab").addEventListener("click", () => switchSellerMode("publish"));
document.querySelector("#sellerPublishedTab").addEventListener("click", () => switchSellerMode("published"));

document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    state.productFilter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
    renderProducts();
  });
});

document.querySelector("#publishProduct").addEventListener("click", () => run(async () => {
  const title = document.querySelector("#productTitle").value.trim();
  const description = document.querySelector("#productDescription").value.trim();
  const price = parseEther(document.querySelector("#productPrice").value.trim());
  const ok = await confirmAction(
    "Publicar producto",
    `Se abrira MetaMask para publicar "${title}" por ${formatEther(price)} ETH. Esta accion no mueve el precio del producto: solo registra la publicacion en Marketplace y paga gas.`
  );
  if (!ok) return;
  const tx = await state.marketplace.publishProduct(title, description, price);
  await trackTx("Producto publicado", tx);
  clearSellerForm();
  await refreshProducts();
  switchSellerMode("published");
}));

elements.productGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-buy]");
  if (!button) return;

  run(async () => {
    const product = state.products.find((item) => item.id.toString() === button.dataset.buy);
    if (product.seller.toLowerCase() === state.account.toLowerCase()) {
      throw new Error("Esta cuenta es la vendedora del producto. Cambia MetaMask a la cuenta compradora y toca 'Conectar / cambiar cuenta'.");
    }
    const ok = await confirmAction(
      "Comprar con escrow",
      `Se abrira MetaMask para depositar ${formatEther(product.price)} ETH en EscrowVault. El vendedor no recibe el dinero todavia: queda custodiado hasta que confirmes recepcion.`
    );
    if (!ok) return;
    const tx = await state.vault.buyProduct(product.id, { value: product.price });
    const receipt = await trackTx("Compra fondeada", tx);
    const event = findEvent(receipt, state.vault, "PurchaseFunded");
    if (event) {
      const purchaseId = event.args.purchaseId.toString();
      document.querySelector("#purchaseId").value = purchaseId;
      await loadPurchaseIntoPanel(purchaseId);
      log(`Compra #${purchaseId} creada y fondeada. El ETH ya esta dentro del vault.`);
    }
    await refreshProducts();
  });
});

document.querySelector("#loadPurchase").addEventListener("click", () => run(async () => {
  const purchaseId = document.querySelector("#purchaseId").value.trim();
  await loadPurchaseIntoPanel(purchaseId);
}));

document.querySelector("#confirmReceipt").addEventListener("click", () => run(async () => {
  const purchaseId = document.querySelector("#purchaseId").value.trim();
  const ok = await confirmAction(
    "Confirmar recepcion",
    `Se abrira MetaMask para confirmar la compra #${purchaseId}. No se vuelve a pagar el precio: solo pagas gas y el contrato libera al vendedor el ETH que ya estaba custodiado.`
  );
  if (!ok) return;
  const tx = await state.vault.confirmReceipt(purchaseId);
  await trackTx("Recepcion confirmada", tx);
  await waitForPurchaseStatus(purchaseId, 1);
  await loadPurchaseIntoPanel(purchaseId);
  await refreshProducts();
  log("Producto recibido. Confirmar recepcion no descuenta el precio otra vez: solo paga gas y libera el deposito del vault al vendedor.");
}));

document.querySelector("#refundBuyer").addEventListener("click", () => run(async () => {
  const purchaseId = document.querySelector("#purchaseId").value.trim();
  const ok = await confirmAction(
    "Cancelar compra",
    `Se abrira MetaMask para cancelar la compra #${purchaseId}. Si sigue activa, EscrowVault devuelve el ETH custodiado al comprador.`
  );
  if (!ok) return;
  const tx = await state.vault.refundBuyer(purchaseId);
  await trackTx("Compra cancelada", tx);
  await waitForPurchaseStatus(purchaseId, 2);
  await loadPurchaseIntoPanel(purchaseId);
  await refreshProducts();
}));

document.querySelector("#pauseProduct").addEventListener("click", () => run(async () => {
  const productId = document.querySelector("#sellerProductId").value.trim();
  const ok = await confirmAction("Pausar publicacion", `Se abrira MetaMask para pausar el producto #${productId}. Mientras este pausado no podra ser comprado.`);
  if (!ok) return;
  const tx = await state.marketplace.setProductActive(productId, false);
  await trackTx("Producto pausado", tx);
  await refreshProducts();
}));

document.querySelector("#activateProduct").addEventListener("click", () => run(async () => {
  const productId = document.querySelector("#sellerProductId").value.trim();
  const ok = await confirmAction("Reactivar publicacion", `Se abrira MetaMask para reactivar el producto #${productId}. Volvera a aparecer disponible para compradores.`);
  if (!ok) return;
  const tx = await state.marketplace.setProductActive(productId, true);
  await trackTx("Producto reactivado", tx);
  await refreshProducts();
}));

document.querySelector("#deleteProduct").addEventListener("click", () => run(async () => {
  const productId = document.querySelector("#sellerProductId").value.trim();
  const ok = await confirmAction(
    "Eliminar publicacion",
    `Se abrira MetaMask para eliminar logicamente el producto #${productId}. No desaparece del historial de blockchain, pero deja de estar disponible para compra y queda marcado como eliminado en la app.`
  );
  if (!ok) return;
  const tx = await state.marketplace.deleteProduct(productId);
  await trackTx("Producto eliminado", tx);
  await refreshProducts();
}));

window.ethereum?.on?.("accountsChanged", async () => {
  try {
    state.provider = new BrowserProvider(window.ethereum);
    await syncActiveAccount();
    await refreshProducts();
    log(`Cuenta activa actualizada: ${state.account}`);
  } catch (error) {
    log(error.shortMessage || error.message);
  }
});
updateLinks();
renderTxs();
renderProducts();
restoreWalletSession().catch((error) => log(error.shortMessage || error.message));
