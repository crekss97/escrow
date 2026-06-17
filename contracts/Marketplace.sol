// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Marketplace de productos para escrow
/// @author TP Blockchain
/// @notice Permite a vendedores publicar productos y a un EscrowVault autorizado crear compras custodiadas.
contract Marketplace {
    /// @notice Estados posibles de una compra.
    enum PurchaseStatus {
        Funded,
        Completed,
        Cancelled
    }

    /// @notice Producto publicado por un vendedor.
    struct Product {
        address seller;
        uint256 price;
        string title;
        string description;
        bool active;
        bool deleted;
    }

    /// @notice Compra creada desde el EscrowVault cuando un comprador deposita ETH.
    struct Purchase {
        uint256 productId;
        address seller;
        address buyer;
        uint256 price;
        PurchaseStatus status;
    }

    /// @notice Direccion que puede configurar el vault autorizado.
    address public immutable owner;

    /// @notice Direccion del contrato EscrowVault autorizado.
    address public vault;

    /// @notice Proximo identificador que se asignara al publicar un producto.
    uint256 public nextProductId = 1;

    /// @notice Proximo identificador que se asignara al crear una compra.
    uint256 public nextPurchaseId = 1;

    mapping(uint256 productId => Product product) private products;
    mapping(uint256 purchaseId => Purchase purchase) private purchases;

    event VaultUpdated(address indexed vault);
    event ProductPublished(uint256 indexed productId, address indexed seller, uint256 price, string title, string description);
    event ProductStatusChanged(uint256 indexed productId, bool active);
    event ProductDeleted(uint256 indexed productId);
    event PurchaseCreated(uint256 indexed purchaseId, uint256 indexed productId, address indexed buyer, address seller, uint256 price);
    event PurchaseCompleted(uint256 indexed purchaseId);
    event PurchaseCancelled(uint256 indexed purchaseId);

    error OnlyOwner();
    error OnlyVault();
    error InvalidAddress();
    error InvalidPrice();
    error ProductNotFound();
    error ProductInactive();
    error PurchaseNotFound();
    error InvalidStatus();
    error NotSeller();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /// @notice Define el contrato EscrowVault autorizado a crear y actualizar compras.
    /// @param newVault Direccion del contrato EscrowVault.
    function setVault(address newVault) external onlyOwner {
        if (newVault == address(0)) revert InvalidAddress();
        vault = newVault;
        emit VaultUpdated(newVault);
    }

    /// @notice Publica un producto disponible para ser comprado con escrow.
    /// @param title Titulo corto del producto.
    /// @param description Descripcion del producto.
    /// @param price Precio exacto en wei.
    /// @return productId Identificador del producto publicado.
    function publishProduct(string calldata title, string calldata description, uint256 price) external returns (uint256 productId) {
        if (price == 0) revert InvalidPrice();

        productId = nextProductId++;
        products[productId] = Product({
            seller: msg.sender,
            price: price,
            title: title,
            description: description,
            active: true,
            deleted: false
        });

        emit ProductPublished(productId, msg.sender, price, title, description);
    }

    /// @notice Activa o desactiva una publicacion propia.
    /// @param productId Identificador del producto.
    /// @param active Nuevo estado de la publicacion.
    function setProductActive(uint256 productId, bool active) external {
        Product storage product = products[productId];
        if (product.seller == address(0)) revert ProductNotFound();
        if (product.deleted) revert ProductInactive();
        if (product.seller != msg.sender) revert NotSeller();

        product.active = active;
        emit ProductStatusChanged(productId, active);
    }

    /// @notice Elimina logicamente una publicacion propia para que no pueda comprarse ni listarse como activa.
    /// @param productId Identificador del producto.
    function deleteProduct(uint256 productId) external {
        Product storage product = products[productId];
        if (product.seller == address(0)) revert ProductNotFound();
        if (product.seller != msg.sender) revert NotSeller();

        product.active = false;
        product.deleted = true;
        emit ProductDeleted(productId);
    }

    /// @notice Crea una compra fondeada. Solo puede llamarlo EscrowVault.
    /// @param productId Identificador del producto comprado.
    /// @param buyer Direccion compradora que deposito ETH.
    /// @return purchaseId Identificador de la compra creada.
    function createFundedPurchase(uint256 productId, address buyer) external onlyVault returns (uint256 purchaseId) {
        Product storage product = products[productId];
        if (product.seller == address(0)) revert ProductNotFound();
        if (!product.active || product.deleted) revert ProductInactive();
        if (buyer == address(0) || buyer == product.seller) revert InvalidAddress();

        purchaseId = nextPurchaseId++;
        purchases[purchaseId] = Purchase({
            productId: productId,
            seller: product.seller,
            buyer: buyer,
            price: product.price,
            status: PurchaseStatus.Funded
        });

        emit PurchaseCreated(purchaseId, productId, buyer, product.seller, product.price);
    }

    /// @notice Marca una compra como completada. Solo puede llamarlo EscrowVault.
    /// @param purchaseId Identificador de la compra.
    function markCompleted(uint256 purchaseId) external onlyVault {
        Purchase storage purchase = purchases[purchaseId];
        if (purchase.seller == address(0)) revert PurchaseNotFound();
        if (purchase.status != PurchaseStatus.Funded) revert InvalidStatus();

        purchase.status = PurchaseStatus.Completed;
        emit PurchaseCompleted(purchaseId);
    }

    /// @notice Marca una compra como cancelada. Solo puede llamarlo EscrowVault.
    /// @param purchaseId Identificador de la compra.
    function markCancelled(uint256 purchaseId) external onlyVault {
        Purchase storage purchase = purchases[purchaseId];
        if (purchase.seller == address(0)) revert PurchaseNotFound();
        if (purchase.status != PurchaseStatus.Funded) revert InvalidStatus();

        purchase.status = PurchaseStatus.Cancelled;
        emit PurchaseCancelled(purchaseId);
    }

    /// @notice Indica si una compra existe.
    /// @param purchaseId Identificador a consultar.
    /// @return exists Verdadero si la compra fue creada.
    function purchaseExists(uint256 purchaseId) external view returns (bool exists) {
        return purchases[purchaseId].seller != address(0);
    }

    /// @notice Indica si una compra esta fondeada y pendiente.
    /// @param purchaseId Identificador a consultar.
    /// @return active Verdadero si esta en estado Funded.
    function isPurchaseActive(uint256 purchaseId) external view returns (bool active) {
        return purchases[purchaseId].seller != address(0) && purchases[purchaseId].status == PurchaseStatus.Funded;
    }

    /// @notice Devuelve todos los datos de un producto.
    /// @param productId Identificador a consultar.
    /// @return seller Direccion vendedora.
    /// @return price Precio exacto en wei.
    /// @return title Titulo del producto.
    /// @return description Descripcion del producto.
    /// @return active Verdadero si el producto esta publicado.
    /// @return deleted Verdadero si el vendedor elimino la publicacion.
    function getProduct(uint256 productId)
        external
        view
        returns (address seller, uint256 price, string memory title, string memory description, bool active, bool deleted)
    {
        Product storage product = products[productId];
        if (product.seller == address(0)) revert ProductNotFound();

        return (product.seller, product.price, product.title, product.description, product.active, product.deleted);
    }

    /// @notice Devuelve todos los datos de una compra.
    /// @param purchaseId Identificador a consultar.
    /// @return productId Identificador del producto comprado.
    /// @return seller Direccion vendedora.
    /// @return buyer Direccion compradora.
    /// @return price Precio exacto en wei.
    /// @return status Estado actual de la compra.
    function getPurchase(uint256 purchaseId)
        external
        view
        returns (uint256 productId, address seller, address buyer, uint256 price, PurchaseStatus status)
    {
        Purchase storage purchase = purchases[purchaseId];
        if (purchase.seller == address(0)) revert PurchaseNotFound();

        return (purchase.productId, purchase.seller, purchase.buyer, purchase.price, purchase.status);
    }
}
