const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with: ${deployer.address}`);
  console.log(`Network: ${network.name}`);

  const Marketplace = await ethers.getContractFactory("Marketplace");
  const marketplace = await Marketplace.deploy();
  await marketplace.waitForDeployment();

  const EscrowVault = await ethers.getContractFactory("EscrowVault");
  const vault = await EscrowVault.deploy(await marketplace.getAddress());
  await vault.waitForDeployment();

  const tx = await marketplace.setVault(await vault.getAddress());
  await tx.wait();

  const deployment = {
    network: network.name,
    marketplace: await marketplace.getAddress(),
    escrowVault: await vault.getAddress(),
    deployedAt: new Date().toISOString()
  };

  const rootPath = path.join(__dirname, "..", "deployments.json");
  fs.writeFileSync(rootPath, JSON.stringify(deployment, null, 2));

  const frontendPath = path.join(__dirname, "..", "frontend", "src", "deployments.json");
  fs.mkdirSync(path.dirname(frontendPath), { recursive: true });
  fs.writeFileSync(frontendPath, JSON.stringify(deployment, null, 2));

  console.log("Deployment saved:");
  console.log(deployment);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
