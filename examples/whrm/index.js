'use strict';

const {
  getDefaultProvider,
  Contract,
  Wallet,
  constants: { AddressZero, MaxUint256 },
  utils: { keccak256, defaultAbiCoder },
} = require('ethers');
const { deployUpgradable } = require('@axelar-network/axelar-gmp-sdk-solidity');

const {
  utils: { deployContract },
} = require('@axelar-network/axelar-local-dev');

const WhrmToken = require('../../artifacts/examples/whrm/WHrmToken.sol/WHrmToken.json');
const WhrmTokenLinker = require('../../artifacts/examples/whrm/WHrmTokenLinker.sol/WHrmTokenLinker.json');
const IAxelarGateway = require('../../artifacts/@axelar-network/axelar-gmp-sdk-solidity/contracts/interfaces/IAxelarGateway.sol/IAxelarGateway.json');

async function deploy(chain, wallet) {
  console.log(`Deploying Whrm for ${chain.name}.`);

  const gateway = new Contract(chain.gateway, IAxelarGateway.abi, wallet);

  const contract = await deployContract(wallet, WhrmToken, []);
  const linkerContract = await deployContract(wallet, WhrmTokenLinker, [
    chain.name,
    gateway.address,
    chain.gasReceiver,
    contract.address,
  ]);

  chain.crossChainToken = contract.address;
  chain.linker = linkerContract.address;
  console.log(`Deployed WHrm Token for ${chain.name} at ${chain.crossChainToken}.`);
  console.log(`Deployed WHrm Token Linker for ${chain.name} at ${chain.linker}.`);
}

async function test(chains, wallet, options) {
  const args = options.args || [];
  const getGasPrice = options.getGasPrice;
  for (const chain of chains) {
    const provider = getDefaultProvider(chain.rpc);
    chain.wallet = wallet.connect(provider);

    const gateway = new Contract(chain.gateway, IAxelarGateway.abi, wallet);

    chain.contract = await deployContract(chain.wallet, WhrmToken, []);
    chain.linker = await deployContract(chain.wallet, WhrmTokenLinker, [
      chain.name,
      chain.gateway,
      chain.gasReceiver,
      chain.contract.address,
    ]);
    console.log(chain.name, 'whrm contract deployed:', chain.contract.address);
    console.log(chain.name, 'whrm linker contract deployed:', chain.linker.address);
  }
  const source = chains.find((chain) => chain.name === (args[0] || 'Avalanche'));
  const destination = chains.find((chain) => chain.name === (args[1] || 'Fantom'));
  const amount = parseInt(args[2]) || 1e5;

  async function print() {
    console.log(`Balance at ${source.name} is ${await source.contract.balanceOf(wallet.address)}`);
    console.log(
      `Balance at ${destination.name} is ${await destination.contract.balanceOf(wallet.address)}`,
    );
  }
  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, ms);
    });
  }
  const initialBalance = (await destination.contract.balanceOf(wallet.address)).toNumber();
  console.log('--- Initially ---');
  await print();

  // Set the gasLimit to 3e5 (a safe overestimate) and get the gas price (this is constant and always 1).
  const gasLimit = 500000;
  const gasPrice = await getGasPrice(source, destination, AddressZero);

  await (await source.contract.mint(wallet.address, amount)).wait();
  console.log('--- After getting some token on the source chain ---');
  await print();

  for (const chain of chains) {
    // add linkers works here

    await (
      await chain.linker.addLinkers(
        [
          chains[0].linker.address,
          chains[1].linker.address,
          chains[2].linker.address,
          chains[3].linker.address,
          chains[4].linker.address,
        ],
        [chains[0].name, chains[1].name, chains[2].name, chains[3].name, chains[4].name],
        { gasLimit: gasLimit },
      )
    ).wait();
    console.log('adding linkers to', chain.name, 'linker contract');
    await sleep(500);

    const minterRole = keccak256(Buffer.from('MINTER_ROLE', 'utf-8'));

    await (await chain.contract.grantRole(minterRole, chain.linker.address)).wait();
    console.log('giving minter role to token linker contract');
    await sleep(500);
  }

  console.log(chains[0].name, 'linker contract:', chains[0].linker.address);
  console.log(chains[1].name, 'linker contract:', chains[1].linker.address);
  console.log(chains[2].name, 'linker contract:', chains[2].linker.address);
  console.log(chains[3].name, 'linker contract:', chains[3].linker.address);
  console.log(chains[4].name, 'linker contract:', chains[4].linker.address);

  await sleep(4000);

  console.log('giving approval to token linker contract');

  let tx = await source.contract.increaseAllowance(source.linker.address, MaxUint256);
  let receipt = await tx.wait();

  console.log('sending token: ');

  try {
    tx = await source.linker.sendToken(
      destination.name,
      wallet.address,
      amount,

      { value: BigInt(Math.floor(gasLimit * gasPrice)), gasLimit: gasLimit },
    );
    let receipt = await tx.wait();
  } catch (error) {
    console.log('');
    console.log('ERROR !');
    console.log(error);
  }

  await sleep(2000);
  /*
  await (
    await source.contract.transferRemote(destination.name, wallet.address, amount, {
      value: BigInt(Math.floor(gasLimit * gasPrice)),
    })
  ).wait();

  */

  while ((await destination.contract.balanceOf(wallet.address)).toNumber() === initialBalance) {
    await print();
    await sleep(2000);
  }

  console.log('--- After ---');
  await print();
}

module.exports = {
  deploy,
  test,
};
