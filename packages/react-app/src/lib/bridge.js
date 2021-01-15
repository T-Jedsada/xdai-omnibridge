import { BigNumber, Contract } from 'ethers';

import { getGasPrice } from './gasPrice';
import {
  getBridgeNetwork,
  getMediatorAddress,
  isxDaiChain,
  logError,
} from './helpers';
import { getOverriddenToToken, isOverridden } from './overrides';
import { getEthersProvider } from './providers';
import { fetchTokenDetails } from './token';

const getToName = (fromName, fromxDai) => {
  if (fromxDai) {
    if (fromName.includes('BSC')) return fromName.slice(0, -7);
    return `${fromName} on Mainnet`;
  }
  if (fromName.includes('Mainnet')) return fromName.slice(0, -11);
  return `${fromName} on BSC`;
};

export const fetchToTokenDetails = async ({
  name: fromName,
  chainId: fromChainId,
  address: fromAddress,
}) => {
  const toChainId = getBridgeNetwork(fromChainId);
  const isxDai = isxDaiChain(fromChainId);
  if (isOverridden(fromAddress)) {
    return fetchTokenDetails(getOverriddenToToken(fromAddress, fromChainId));
  }
  const fromEthersProvider = getEthersProvider(fromChainId);
  const toEthersProvider = getEthersProvider(toChainId);
  const fromMediatorAddress = getMediatorAddress(fromChainId);
  const toMediatorAddress = getMediatorAddress(toChainId);
  const abi = [
    'function isRegisteredAsNativeToken(address) view returns (bool)',
    'function bridgedTokenAddress(address) view returns (address)',
    'function nativeTokenAddress(address) view returns (address)',
  ];
  const fromMediatorContract = new Contract(
    fromMediatorAddress,
    abi,
    fromEthersProvider,
  );
  const isNativeToken = await fromMediatorContract.isRegisteredAsNativeToken(
    fromAddress,
  );

  if (isNativeToken) {
    const toMediatorContract = new Contract(
      toMediatorAddress,
      abi,
      toEthersProvider,
    );

    const toAddress = await toMediatorContract.bridgedTokenAddress(fromAddress);

    const toName = isxDai ? `${fromName} on Mainnet` : `${fromName} on BSC`;
    return {
      name: toName,
      chainId: toChainId,
      address: toAddress,
      mode: 'erc677',
      mediator: toMediatorAddress,
    };
  }
  const toAddress = await fromMediatorContract.nativeTokenAddress(fromAddress);

  const toName = getToName(fromName, isxDai);
  return {
    name: toName,
    chainId: toChainId,
    address: toAddress,
    mode: 'erc20',
    mediator: toMediatorAddress,
  };
};

export const fetchToAmount = async (
  isRewardAddress,
  feeType,
  fromToken,
  toToken,
  fromAmount,
) => {
  if (fromAmount <= 0 || !fromToken || !toToken) return BigNumber.from(0);
  if (isRewardAddress || isOverridden(fromToken.address)) {
    return fromAmount;
  }
  const isxDai = isxDaiChain(toToken.chainId);
  const xDaiChainId = isxDai ? toToken.chainId : fromToken.chainId;
  const tokenAddress = isxDai ? toToken.address : fromToken.address;
  const ethersProvider = getEthersProvider(xDaiChainId);
  const mediatorAddress = isxDai ? toToken.mediator : fromToken.mediator;
  const abi = [
    'function calculateFee(bytes32, address, uint256) view returns (uint256)',
  ];
  const mediatorContract = new Contract(mediatorAddress, abi, ethersProvider);

  try {
    const fee = await mediatorContract.calculateFee(
      feeType,
      tokenAddress,
      fromAmount,
    );
    return fromAmount.sub(fee);
  } catch (amountError) {
    logError({ amountError });
    return fromAmount;
  }
};

export const fetchToToken = async fromToken => {
  const toToken = await fetchToTokenDetails(
    fromToken,
  ).catch(tokenDetailsError => logError({ tokenDetailsError }));

  return {
    symbol: fromToken.symbol,
    decimals: fromToken.decimals,
    logoURI: '',
    ...toToken,
  };
};

export const fetchTokenLimits = async (
  ethersProvider,
  token,
  toToken,
  currentDay,
) => {
  const isOverriddenToken = isOverridden(token.address);
  const abi = isOverriddenToken
    ? [
        'function minPerTx() view returns (uint256)',
        'function executionMaxPerTx() view returns (uint256)',
        'function executionDailyLimit() view returns (uint256)',
        'function totalExecutedPerDay(uint256) view returns (uint256)',
      ]
    : [
        'function minPerTx(address) view returns (uint256)',
        'function executionMaxPerTx(address) view returns (uint256)',
        'function executionDailyLimit(address) view returns (uint256)',
        'function totalExecutedPerDay(address, uint256) view returns (uint256)',
      ];

  try {
    const mediatorContract = new Contract(token.mediator, abi, ethersProvider);
    const toMediatorContract = new Contract(
      toToken.mediator,
      abi,
      getEthersProvider(toToken.chainId),
    );
    const [
      minPerTx,
      executionMaxPerTx,
      executionDailyLimit,
      totalExecutedPerDay,
    ] = isOverriddenToken
      ? await Promise.all([
          mediatorContract.minPerTx(),
          toMediatorContract.executionMaxPerTx(),
          mediatorContract.executionDailyLimit(),
          toMediatorContract.totalExecutedPerDay(currentDay),
        ])
      : await Promise.all([
          mediatorContract.minPerTx(token.address),
          toMediatorContract.executionMaxPerTx(toToken.address),
          mediatorContract.executionDailyLimit(token.address),
          toMediatorContract.totalExecutedPerDay(toToken.address, currentDay),
        ]);
    return {
      minPerTx,
      maxPerTx: executionMaxPerTx,
      dailyLimit: executionDailyLimit.sub(totalExecutedPerDay),
    };
  } catch (error) {
    logError({ tokenError: error });
    return {
      minPerTx: BigNumber.from(0),
      maxPerTx: BigNumber.from(0),
      dailyLimit: BigNumber.from(0),
    };
  }
};

export const relayTokens = async (ethersProvider, token, receiver, amount) => {
  const signer = ethersProvider.getSigner();
  const { chainId, mode, mediator, address } = token;
  const gasPrice = getGasPrice(chainId);
  switch (mode) {
    case 'erc677': {
      const abi = ['function transferAndCall(address, uint256, bytes)'];
      const tokenContract = new Contract(address, abi, signer);
      return tokenContract.transferAndCall(mediator, amount, receiver, {
        gasPrice,
      });
    }
    case 'dedicated-erc20': {
      const abi = ['function relayTokens(address, uint256)'];
      const mediatorContract = new Contract(mediator, abi, signer);
      return mediatorContract.relayTokens(receiver, amount, { gasPrice });
    }
    case 'erc20':
    default: {
      const abi = ['function relayTokens(address, address, uint256)'];
      const mediatorContract = new Contract(mediator, abi, signer);
      return mediatorContract.relayTokens(token.address, receiver, amount, {
        gasPrice,
      });
    }
  }
};

export const transferTokens = async (
  ethersProvider,
  token,
  receiver,
  amount,
) => {
  return relayTokens(ethersProvider, token, receiver, amount);
};
