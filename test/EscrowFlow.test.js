const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Sistema Marketplace + EscrowVault", function () {
  const price = ethers.parseEther("0.02");

  async function deployFixture() {
    const [owner, seller, buyer, stranger] = await ethers.getSigners();

    const Marketplace = await ethers.getContractFactory("Marketplace");
    const marketplace = await Marketplace.deploy();

    const EscrowVault = await ethers.getContractFactory("EscrowVault");
    const vault = await EscrowVault.deploy(await marketplace.getAddress());

    await marketplace.setVault(await vault.getAddress());

    return { owner, seller, buyer, stranger, marketplace, vault };
  }

  async function publishProduct(marketplace, seller) {
    await marketplace.connect(seller).publishProduct("Notebook", "Notebook usada en buen estado", price);
    return 1n;
  }

  async function buyProduct(marketplace, vault, seller, buyer) {
    const productId = await publishProduct(marketplace, seller);
    await vault.connect(buyer).buyProduct(productId, { value: price });
    return { productId, purchaseId: 1n };
  }

  it("permite al vendedor publicar un producto activo", async function () {
    const { marketplace, seller } = await deployFixture();

    await expect(marketplace.connect(seller).publishProduct("Notebook", "Notebook usada en buen estado", price))
      .to.emit(marketplace, "ProductPublished")
      .withArgs(1, seller.address, price, "Notebook", "Notebook usada en buen estado");

    const product = await marketplace.getProduct(1);
    expect(product.seller).to.equal(seller.address);
    expect(product.price).to.equal(price);
    expect(product.title).to.equal("Notebook");
    expect(product.active).to.equal(true);
    expect(product.deleted).to.equal(false);
  });

  it("rechaza publicar productos con precio cero", async function () {
    const { marketplace, seller } = await deployFixture();

    await expect(marketplace.connect(seller).publishProduct("Notebook", "Sin precio", 0))
      .to.be.revertedWithCustomError(marketplace, "InvalidPrice");
  });

  it("permite al vendedor pausar y reactivar una publicacion", async function () {
    const { marketplace, seller } = await deployFixture();
    const productId = await publishProduct(marketplace, seller);

    await expect(marketplace.connect(seller).setProductActive(productId, false))
      .to.emit(marketplace, "ProductStatusChanged")
      .withArgs(productId, false);

    let product = await marketplace.getProduct(productId);
    expect(product.active).to.equal(false);

    await marketplace.connect(seller).setProductActive(productId, true);
    product = await marketplace.getProduct(productId);
    expect(product.active).to.equal(true);
  });

  it("rechaza cambiar una publicacion desde una cuenta que no es vendedora", async function () {
    const { marketplace, seller, stranger } = await deployFixture();
    const productId = await publishProduct(marketplace, seller);

    await expect(marketplace.connect(stranger).setProductActive(productId, false))
      .to.be.revertedWithCustomError(marketplace, "NotSeller");
  });

  it("permite al vendedor eliminar una publicacion", async function () {
    const { marketplace, seller } = await deployFixture();
    const productId = await publishProduct(marketplace, seller);

    await expect(marketplace.connect(seller).deleteProduct(productId))
      .to.emit(marketplace, "ProductDeleted")
      .withArgs(productId);

    const product = await marketplace.getProduct(productId);
    expect(product.active).to.equal(false);
    expect(product.deleted).to.equal(true);
  });

  it("rechaza comprar un producto eliminado", async function () {
    const { marketplace, vault, seller, buyer } = await deployFixture();
    const productId = await publishProduct(marketplace, seller);
    await marketplace.connect(seller).deleteProduct(productId);

    await expect(vault.connect(buyer).buyProduct(productId, { value: price }))
      .to.be.revertedWithCustomError(vault, "ProductUnavailable");
  });

  it("permite al comprador comprar un producto depositando el monto exacto", async function () {
    const { marketplace, vault, seller, buyer } = await deployFixture();
    const productId = await publishProduct(marketplace, seller);

    await expect(vault.connect(buyer).buyProduct(productId, { value: price }))
      .to.emit(vault, "PurchaseFunded")
      .withArgs(1, productId, buyer.address, seller.address, price)
      .and.to.emit(marketplace, "PurchaseCreated")
      .withArgs(1, productId, buyer.address, seller.address, price);

    const purchase = await marketplace.getPurchase(1);
    expect(purchase.productId).to.equal(productId);
    expect(purchase.seller).to.equal(seller.address);
    expect(purchase.buyer).to.equal(buyer.address);
    expect(purchase.status).to.equal(0);
    expect(await vault.deposits(1)).to.equal(price);
  });

  it("rechaza comprar con monto incorrecto", async function () {
    const { marketplace, vault, seller, buyer } = await deployFixture();
    const productId = await publishProduct(marketplace, seller);

    await expect(vault.connect(buyer).buyProduct(productId, { value: ethers.parseEther("0.01") }))
      .to.be.revertedWithCustomError(vault, "InvalidAmount");
  });

  it("rechaza que el vendedor compre su propio producto", async function () {
    const { marketplace, vault, seller } = await deployFixture();
    const productId = await publishProduct(marketplace, seller);

    await expect(vault.connect(seller).buyProduct(productId, { value: price }))
      .to.be.revertedWithCustomError(vault, "ProductUnavailable");
  });

  it("rechaza comprar un producto pausado", async function () {
    const { marketplace, vault, seller, buyer } = await deployFixture();
    const productId = await publishProduct(marketplace, seller);
    await marketplace.connect(seller).setProductActive(productId, false);

    await expect(vault.connect(buyer).buyProduct(productId, { value: price }))
      .to.be.revertedWithCustomError(vault, "ProductUnavailable");
  });

  it("libera el pago al vendedor cuando el comprador confirma recepcion", async function () {
    const { marketplace, vault, seller, buyer } = await deployFixture();
    const { purchaseId } = await buyProduct(marketplace, vault, seller, buyer);

    await expect(vault.connect(buyer).confirmReceipt(purchaseId))
      .to.changeEtherBalances([vault, seller], [-price, price]);

    const purchase = await marketplace.getPurchase(purchaseId);
    expect(purchase.status).to.equal(1);
    expect(await vault.deposits(purchaseId)).to.equal(0);
  });

  it("rechaza confirmar recepcion desde una cuenta que no es compradora", async function () {
    const { marketplace, vault, seller, buyer, stranger } = await deployFixture();
    const { purchaseId } = await buyProduct(marketplace, vault, seller, buyer);

    await expect(vault.connect(stranger).confirmReceipt(purchaseId))
      .to.be.revertedWithCustomError(vault, "OnlyBuyer");
  });

  it("permite al comprador cancelar una compra activa y recibir reembolso", async function () {
    const { marketplace, vault, seller, buyer } = await deployFixture();
    const { purchaseId } = await buyProduct(marketplace, vault, seller, buyer);

    await expect(vault.connect(buyer).refundBuyer(purchaseId))
      .to.changeEtherBalances([vault, buyer], [-price, price]);

    const purchase = await marketplace.getPurchase(purchaseId);
    expect(purchase.status).to.equal(2);
    expect(await vault.deposits(purchaseId)).to.equal(0);
  });
});
