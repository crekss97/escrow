const { run } = require("hardhat");
const deployment = require("../deployments.json");

async function verify(address, constructorArguments = []) {
  try {
    await run("verify:verify", { address, constructorArguments });
    console.log(`Verified: ${address}`);
  } catch (error) {
    if (error.message.toLowerCase().includes("already verified")) {
      console.log(`Already verified: ${address}`);
      return;
    }
    throw error;
  }
}

async function main() {
  await verify(deployment.marketplace);
  await verify(deployment.escrowVault, [deployment.marketplace]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
