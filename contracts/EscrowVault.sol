// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Interfaz minima para interactuar con Marketplace.
interface IMarketplace {
    enum PurchaseStatus {
        Funded,
        Completed,
        Cancelled
    }

    /// @notice Crea una compra fondeada por el comprador.
    /// @param productId Identificador del producto comprado.
    /// @param buyer Direccion compradora.
    /// @return purchaseId Identificador de la compra creada.
    function createFundedPurchase(uint256 productId, address buyer) external returns (uint256 purchaseId);

    /// @notice Indica si una compra existe.
    /// @param purchaseId Identificador a consultar.
    /// @return exists Verdadero si existe.
    function purchaseExists(uint256 purchaseId) external view returns (bool exists);

    /// @notice Indica si una compra esta activa.
    /// @param purchaseId Identificador a consultar.
    /// @return active Verdadero si esta activa.
    function isPurchaseActive(uint256 purchaseId) external view returns (bool active);

    /// @notice Devuelve los datos de un producto.
    /// @param productId Identificador a consultar.
    /// @return seller Direccion vendedora.
    /// @return price Precio exacto en wei.
    /// @return title Titulo del producto.
    /// @return description Descripcion del producto.
    /// @return active Verdadero si esta publicado.
    /// @return deleted Verdadero si fue eliminado.
    function getProduct(uint256 productId)
        external
        view
        returns (address seller, uint256 price, string memory title, string memory description, bool active, bool deleted);

    /// @notice Devuelve los datos de una compra.
    /// @param purchaseId Identificador a consultar.
    /// @return productId Identificador del producto comprado.
    /// @return seller Direccion vendedora.
    /// @return buyer Direccion compradora.
    /// @return price Precio exacto en wei.
    /// @return status Estado actual.
    function getPurchase(uint256 purchaseId)
        external
        view
        returns (uint256 productId, address seller, address buyer, uint256 price, PurchaseStatus status);

    /// @notice Marca una compra como completada.
    /// @param purchaseId Identificador de la compra.
    function markCompleted(uint256 purchaseId) external;

    /// @notice Marca una compra como cancelada.
    /// @param purchaseId Identificador de la compra.
    function markCancelled(uint256 purchaseId) external;
}

/// @title Boveda de escrow para compras del Marketplace
/// @notice Custodia ETH del comprador y lo libera al vendedor cuando el comprador confirma recepcion.
contract EscrowVault {
    /// @notice Contrato Marketplace usado para validar y actualizar compras.
    IMarketplace public immutable marketplace;

    /// @notice Monto depositado en wei por cada compra.
    mapping(uint256 purchaseId => uint256 amount) public deposits;

    bool private locked;

    event PurchaseFunded(uint256 indexed purchaseId, uint256 indexed productId, address indexed buyer, address seller, uint256 amount);
    event ReceiptConfirmed(uint256 indexed purchaseId, address indexed buyer, address indexed seller, uint256 amount);
    event PurchaseRefunded(uint256 indexed purchaseId, address indexed buyer, uint256 amount);

    error ReentrantCall();
    error PurchaseUnavailable();
    error ProductUnavailable();
    error OnlyBuyer();
    error InvalidAmount();
    error TransferFailed();

    modifier nonReentrant() {
        if (locked) revert ReentrantCall();
        locked = true;
        _;
        locked = false;
    }

    /// @notice Inicializa la boveda con el Marketplace asociado.
    /// @param marketplaceAddress Direccion del contrato Marketplace.
    constructor(address marketplaceAddress) {
        if (marketplaceAddress == address(0)) revert ProductUnavailable();
        marketplace = IMarketplace(marketplaceAddress);
    }

    /// @notice Compra un producto publicado y deja el ETH custodiado en escrow.
    /// @param productId Identificador del producto a comprar.
    /// @return purchaseId Identificador de la compra creada.
    function buyProduct(uint256 productId) external payable nonReentrant returns (uint256 purchaseId) {
        (address seller, uint256 price,,, bool active, bool deleted) = marketplace.getProduct(productId);
        if (!active || deleted || seller == msg.sender) revert ProductUnavailable();
        if (msg.value != price) revert InvalidAmount();

        purchaseId = marketplace.createFundedPurchase(productId, msg.sender);
        deposits[purchaseId] = msg.value;

        emit PurchaseFunded(purchaseId, productId, msg.sender, seller, msg.value);
    }

    /// @notice Confirma la recepcion del bien o servicio y libera el pago al vendedor.
    /// @param purchaseId Identificador de la compra a completar.
    function confirmReceipt(uint256 purchaseId) external nonReentrant {
        if (!marketplace.purchaseExists(purchaseId) || !marketplace.isPurchaseActive(purchaseId)) revert PurchaseUnavailable();
        (, address seller, address buyer,, IMarketplace.PurchaseStatus status) = marketplace.getPurchase(purchaseId);
        if (msg.sender != buyer) revert OnlyBuyer();
        if (status != IMarketplace.PurchaseStatus.Funded) revert PurchaseUnavailable();

        uint256 amount = deposits[purchaseId];
        if (amount == 0) revert InvalidAmount();

        deposits[purchaseId] = 0;
        marketplace.markCompleted(purchaseId);

        (bool sent,) = payable(seller).call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit ReceiptConfirmed(purchaseId, buyer, seller, amount);
    }

    /// @notice Cancela una compra activa y devuelve el deposito al comprador.
    /// @param purchaseId Identificador de la compra a cancelar.
    function refundBuyer(uint256 purchaseId) external nonReentrant {
        if (!marketplace.purchaseExists(purchaseId) || !marketplace.isPurchaseActive(purchaseId)) revert PurchaseUnavailable();
        (,, address buyer,, IMarketplace.PurchaseStatus status) = marketplace.getPurchase(purchaseId);
        if (msg.sender != buyer) revert OnlyBuyer();
        if (status != IMarketplace.PurchaseStatus.Funded) revert PurchaseUnavailable();

        uint256 amount = deposits[purchaseId];
        if (amount == 0) revert InvalidAmount();

        deposits[purchaseId] = 0;
        marketplace.markCancelled(purchaseId);

        (bool sent,) = payable(buyer).call{value: amount}("");
        if (!sent) revert TransferFailed();

        emit PurchaseRefunded(purchaseId, buyer, amount);
    }

    /// @notice Devuelve el saldo ETH custodiado por esta boveda.
    /// @return balance Saldo actual del contrato en wei.
    function vaultBalance() external view returns (uint256 balance) {
        return address(this).balance;
    }
}
