import { Alert, AlertIcon, Flex, Text } from '@chakra-ui/react';
import React from 'react';

import { isxDaiChain } from '../lib/helpers';

const ERC20DaiAddress = {
  100: '0x44fA8E6f47987339850636F88629646662444217',
  1: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
  42: '0x4F96Fe3b7A6Cf9725f59d353F723c1bDb64CA6Aa',
  77: '0xa844e8c64608dede1f22f519ad0e98e2629684df',
  56: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
};

export const isERC20DaiAddress = token => {
  if (!token) {
    return false;
  }

  const isxDai = isxDaiChain(token.chainId);
  return (
    !isxDai &&
    token.address.toLowerCase() === ERC20DaiAddress[token.chainId].toLowerCase()
  );
};

export const DaiWarning = () => {
  return (
    <Flex align="flex-middle" direction="column">
      <Alert status="warning" borderRadius={5} mb={5}>
        <AlertIcon minWidth="20px" />
        <Text fontSize="small">
          Bridges DAI on Binance Smart Chain to DAI on xDai, DOES NOT mint
          native xDai.
        </Text>
      </Alert>
    </Flex>
  );
};
