import { simpleFetch } from "@keplr-wallet/simple-fetch";
import { ChainGetter } from "@keplr-wallet/stores";
import {
  AppCurrency,
  EthSignType,
  EthTxReceipt,
  EthTxStatus,
  Keplr,
} from "@keplr-wallet/types";
import { DenomHelper } from "@keplr-wallet/common";
import { erc20ContractInterface } from "../constants";
import { parseUnits } from "@ethersproject/units";
import {
  UnsignedTransaction,
  serialize,
  TransactionTypes,
} from "@ethersproject/transactions";
import { isAddress as isEthereumHexAddress } from "@ethersproject/address";

const TX_RECIEPT_POLLING_INTERVAL = 1000;

export class EthereumAccountBase {
  constructor(
    protected readonly chainGetter: ChainGetter,
    protected readonly chainId: string,
    protected readonly getKeplr: () => Promise<Keplr | undefined>
  ) {}

  async simulateGas({
    currency,
    amount,
    sender,
    recipient,
  }: {
    currency: AppCurrency;
    amount: string;
    sender: string;
    recipient: string;
  }) {
    const chainInfo = this.chainGetter.getChain(this.chainId);
    if (!chainInfo.evm) {
      throw new Error("No EVM chain info provided");
    }

    if (!isEthereumHexAddress(sender)) {
      throw new Error("Invalid sender address");
    }

    // If the recipient address is invalid, the sender address will be used as the recipient for gas estimating gas.
    const tempRecipient = isEthereumHexAddress(recipient) ? recipient : sender;

    const parsedAmount = parseUnits(amount, currency.coinDecimals);
    const denomHelper = new DenomHelper(currency.coinMinimalDenom);

    const unsignedTx =
      denomHelper.type === "erc20"
        ? {
            from: sender,
            to: denomHelper.contractAddress,
            data: erc20ContractInterface.encodeFunctionData("transfer", [
              tempRecipient,
              parsedAmount.toString(),
            ]),
            value: "0x0",
          }
        : {
            from: sender,
            to: tempRecipient,
            value: parsedAmount.isZero() ? "0x0" : parsedAmount.toHexString(),
          };

    const estimateGasResponse = await simpleFetch<{
      result: string;
    }>(chainInfo.evm.rpc, {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_estimateGas",
        params: [unsignedTx],
        id: 1,
      }),
    });

    return {
      gasUsed: Number(estimateGasResponse.data.result),
    };
  }

  async makeSendTokenTx({
    currency,
    amount,
    from,
    to,
    gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  }: {
    currency: AppCurrency;
    amount: string;
    from: string;
    to: string;
    gasLimit: number;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
  }): Promise<UnsignedTransaction> {
    const chainInfo = this.chainGetter.getChain(this.chainId);
    if (chainInfo.evm === undefined) {
      throw new Error("No EVM chain info provided");
    }

    const transactionCountResponse = await simpleFetch<{
      result: string;
    }>(chainInfo.evm.rpc, {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "eth_getTransactionCount",
        params: [from, "pending"],
        id: 1,
      }),
    });

    const parsedAmount = parseUnits(amount, currency.coinDecimals);
    const denomHelper = new DenomHelper(currency.coinMinimalDenom);

    const tx: UnsignedTransaction = {
      // Support EIP-1559 transaction only.
      type: TransactionTypes.eip1559,
      chainId: chainInfo.evm.chainId,
      nonce: Number(transactionCountResponse.data.result),
      gasLimit: "0x" + gasLimit.toString(16),
      maxFeePerGas: "0x" + Number(maxFeePerGas).toString(16),
      maxPriorityFeePerGas: "0x" + Number(maxPriorityFeePerGas).toString(16),
      ...(denomHelper.type === "erc20"
        ? {
            to: denomHelper.contractAddress,
            value: "0x0",
            data: erc20ContractInterface.encodeFunctionData("transfer", [
              to,
              parsedAmount.toHexString(),
            ]),
          }
        : {
            to,
            value: parsedAmount.isZero() ? "0x0" : parsedAmount.toHexString(),
          }),
    };

    return tx;
  }

  async sendEthereumTx(
    sender: string,
    unsignedTx: UnsignedTransaction,
    onTxEvents?: {
      onBroadcastFailed?: (e?: Error) => void;
      onBroadcasted?: (txHash: string) => void;
      onFulfill?: (txReceipt: EthTxReceipt) => void;
    }
  ) {
    const chainInfo = this.chainGetter.getChain(this.chainId);
    if (!chainInfo.evm) {
      throw new Error("No EVM chain info provided");
    }

    let txHash: string;
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const keplr = (await this.getKeplr())!;
      const signEthereum = keplr.signEthereum.bind(keplr);
      const signature = await signEthereum(
        this.chainId,
        sender,
        JSON.stringify(unsignedTx),
        EthSignType.TRANSACTION
      );

      const rawTransaction = serialize(unsignedTx, signature);

      const sendTx = keplr.sendEthereumTx.bind(keplr);
      txHash = await sendTx(this.chainId, rawTransaction);
      if (!txHash) {
        throw new Error("No tx hash responed");
      }

      if (onTxEvents?.onBroadcasted) {
        onTxEvents.onBroadcasted(txHash);
      }

      const checkTxFulfilled = async () => {
        const txRecieptResponse = await simpleFetch<{
          result: EthTxReceipt | null;
          error?: Error;
        }>(chainInfo.evm!.rpc, {
          method: "POST",
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "eth_getTransactionReceipt",
            params: [txHash],
            id: 1,
          }),
        });

        if (txRecieptResponse.data.error) {
          console.error(txRecieptResponse.data.error);
          clearInterval(intervalId);
        }

        const txReceipt = txRecieptResponse.data.result;
        if (txReceipt) {
          clearInterval(intervalId);
          if (txReceipt.status === EthTxStatus.Success) {
            onTxEvents?.onFulfill?.(txReceipt);
          } else {
            onTxEvents?.onBroadcastFailed?.(new Error("Tx failed on chain"));
          }
        }
      };
      const intervalId = setInterval(
        checkTxFulfilled,
        TX_RECIEPT_POLLING_INTERVAL
      );

      return txHash;
    } catch (e) {
      if (onTxEvents?.onBroadcastFailed) {
        onTxEvents.onBroadcastFailed(e);
      }

      throw e;
    }
  }
}