import React, { FunctionComponent, useEffect, useState } from "react";
import { Modal } from "../modal";
import { Box } from "../box";
import { ColorPalette } from "../../styles";
import styled from "styled-components";
import { Body2, H5, Subtitle1, Subtitle3 } from "../typography";
import { Gutter } from "../gutter";
import { HorizontalRadioGroup } from "../radio-group";
import { YAxis } from "../axis";
import { Stack } from "../stack";
import { Bech32Address } from "@keplr-wallet/cosmos";
import Color from "color";
import { observer } from "mobx-react-lite";
import { useStore } from "../../stores";
import { Key } from "@keplr-wallet/types";
import { IMemoConfig, IRecipientConfig } from "@keplr-wallet/hooks";
import { Bleed } from "../bleed";

const Styles = {
  Container: styled.div`
    display: flex;
    flex-direction: column;
  `,
  ListContainer: styled.div`
    flex: 1;
    overflow-y: scroll;
  `,

  AddressItemContainer: styled(Box)`
    background-color: ${ColorPalette["gray-600"]};
    &:hover {
      background-color: ${Color(ColorPalette["gray-500"]).alpha(0.5).string()};
    }
  `,
};

type Type = "recent" | "contacts" | "accounts";

export const AddressBookModal: FunctionComponent<{
  chainId: string;
  isOpen: boolean;
  close: () => void;

  recipientConfig: IRecipientConfig;
  memoConfig: IMemoConfig;
}> = observer(({ chainId, isOpen, close, recipientConfig, memoConfig }) => {
  const { uiConfigStore, keyRingStore } = useStore();

  // TODO: Implement "recent"
  const [type, setType] = useState<Type>("recent");

  const [accounts, setAccounts] = useState<Key[]>([]);

  useEffect(() => {
    const vaultIds = keyRingStore.keyInfos
      .map((keyInfo) => {
        return keyInfo.id;
      })
      .filter((id) => {
        return id !== keyRingStore.selectedKeyInfo?.id;
      });

    if (vaultIds.length > 0) {
      uiConfigStore.addressBookConfig
        .getVaultCosmosKeysSettled(chainId, vaultIds)
        .then((keys) => {
          setAccounts(
            keys
              .filter((res) => {
                return res.status === "fulfilled";
              })
              .map((res) => {
                if (res.status === "fulfilled") {
                  return res.value;
                }
                throw new Error("Unexpected status");
              })
          );
        });
    } else {
      setAccounts([]);
    }
  }, [
    chainId,
    keyRingStore.keyInfos,
    keyRingStore.selectedKeyInfo?.id,
    uiConfigStore.addressBookConfig,
  ]);

  const datas: { name: string; address: string; memo?: string }[] = (() => {
    switch (type) {
      case "contacts": {
        return uiConfigStore.addressBookConfig
          .getAddressBook(chainId)
          .map((addressData) => {
            return {
              name: addressData.name,
              address: addressData.address,
              memo: addressData.memo,
            };
          });
      }
      case "accounts": {
        return accounts.map((account) => {
          return {
            name: account.name,
            address: account.bech32Address,
          };
        });
      }
      default: {
        return [];
      }
    }
  })();

  return (
    <Modal isOpen={isOpen} close={close} align="bottom">
      <Box
        maxHeight="30.625rem"
        minHeight="21.5rem"
        backgroundColor={ColorPalette["gray-600"]}
        paddingX="0.75rem"
        paddingTop="1rem"
      >
        <Box paddingX="0.5rem" paddingY="0.375rem">
          <Subtitle1
            style={{
              color: ColorPalette["white"],
            }}
          >
            Address List
          </Subtitle1>
        </Box>

        <Gutter size="0.75rem" />

        <YAxis alignX="left">
          <HorizontalRadioGroup
            items={[
              {
                key: "recent",
                text: "Recent",
              },
              {
                key: "contacts",
                text: "Contacts",
              },
              {
                key: "accounts",
                text: "My account",
              },
            ]}
            selectedKey={type}
            onSelect={(key) => {
              setType(key as Type);
            }}
          />
        </YAxis>

        <Gutter size="0.75rem" />

        {datas.length > 0 ? (
          <Styles.ListContainer>
            <Stack gutter="0.75rem">
              {datas.map((data, i) => {
                return (
                  <AddressItem
                    key={i}
                    name={data.name}
                    address={data.address}
                    memo={data.memo}
                    onClick={() => {
                      recipientConfig.setValue(data.address);
                      memoConfig.setValue(data.memo ?? "");

                      close();
                    }}
                  />
                );
              })}
              <Gutter size="0.75rem" />
            </Stack>
          </Styles.ListContainer>
        ) : (
          <Box
            alignX="center"
            alignY="center"
            style={{
              flex: 1,
              color: ColorPalette["gray-400"],
            }}
          >
            <Bleed top="3rem">
              <YAxis alignX="center">
                <EmptyIcon size="4.5rem" />
                <Gutter size="1.25rem" />
                <Subtitle3>
                  {(() => {
                    switch (type) {
                      case "accounts":
                        return "No other wallet found";
                      default:
                        return "No Data Yet";
                    }
                  })()}
                </Subtitle3>
              </YAxis>
            </Bleed>
          </Box>
        )}
      </Box>
    </Modal>
  );
});

const AddressItem: FunctionComponent<{
  name: string;
  address: string;
  memo?: string;

  onClick: () => void;
}> = ({ name, address, memo, onClick }) => {
  return (
    <Styles.AddressItemContainer
      paddingX="1rem"
      paddingY="0.75rem"
      borderRadius="0.375rem"
      cursor="pointer"
      onClick={(e) => {
        e.preventDefault();

        onClick();
      }}
    >
      <H5
        style={{
          color: ColorPalette["gray-10"],
        }}
      >
        {name}
      </H5>
      <Gutter size="0.25rem" />

      <Body2
        style={{
          color: ColorPalette["gray-200"],
        }}
      >
        {Bech32Address.shortenAddress(address, 30)}
      </Body2>
      {memo ? <Gutter size="0.25rem" /> : null}

      {memo ? (
        <Body2
          style={{
            color: ColorPalette["gray-200"],
          }}
        >
          {memo}
        </Body2>
      ) : null}
    </Styles.AddressItemContainer>
  );
};

const EmptyIcon: FunctionComponent<{
  size: string;
}> = ({ size }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="none"
      viewBox="0 0 72 72"
    >
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="7.5"
        d="M45.5 40.5h-18m12.182-21.568l-6.364-6.364a4.5 4.5 0 00-3.182-1.318H14A6.75 6.75 0 007.25 18v36A6.75 6.75 0 0014 60.75h45A6.75 6.75 0 0065.75 54V27A6.75 6.75 0 0059 20.25H42.864a4.5 4.5 0 01-3.182-1.318z"
      />
    </svg>
  );
};