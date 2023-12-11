import React, {
  FunctionComponent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {observer} from 'mobx-react-lite';
import {useStore} from '../../stores';
import {FormattedMessage, useIntl} from 'react-intl';
import {useStyle} from '../../styles';
import {useNavigation} from '@react-navigation/native';
import {WalletStatus} from '@keplr-wallet/stores';
import {autorun} from 'mobx';
import {StackNavProp} from '../../navigation';
import {PageWithScrollView} from '../../components/page';
import {Text} from 'react-native';
import {Box} from '../../components/box';
import LottieView from 'lottie-react-native';
import {Gutter} from '../../components/gutter';
import {TextInput} from '../../components/input';
import {Button} from '../../components/button';
import {TextButton} from '../../components/text-button';
import delay from 'delay';

export const UnlockScreen: FunctionComponent = observer(() => {
  const {keyRingStore, keychainStore, accountStore, chainStore} = useStore();

  const intl = useIntl();
  const style = useStyle();
  const navigation = useNavigation<StackNavProp>();

  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isBiometricLoading, setIsBiometricLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>();

  const tryBiometricAutoOnce = useRef(false);

  const waitAccountInit = useCallback(async () => {
    if (keyRingStore.status === 'unlocked') {
      for (const chainInfo of chainStore.chainInfos) {
        const account = accountStore.getAccount(chainInfo.chainId);
        if (account.walletStatus === WalletStatus.NotInit) {
          account.init();
        }
      }

      await new Promise<void>(resolve => {
        const disposal = autorun(() => {
          // account init은 동시에 발생했을때 debounce가 되므로
          // 첫번째꺼 하나만 확인해도 된다.
          if (
            accountStore.getAccount(chainStore.chainInfos[0].chainId)
              .bech32Address
          ) {
            resolve();
            if (disposal) {
              disposal();
            }
          }
        });
      });
    }
  }, [accountStore, chainStore, keyRingStore]);

  const tryBiometric = useCallback(async () => {
    try {
      setIsBiometricLoading(true);

      // Because javascript is synchronous language, the loadnig state change would not delivered to the UI thread
      // So to make sure that the loading state changes, just wait very short time.
      await delay(10);
      await keychainStore.tryUnlockWithBiometry();
      await waitAccountInit();
      navigation.replace('Home');
    } catch (e) {
      console.log(e);
    } finally {
      setIsBiometricLoading(false);
    }
  }, [keychainStore, navigation, waitAccountInit]);

  const tryUnlock = async () => {
    try {
      setIsLoading(true);

      // Decryption needs slightly huge computation.
      // Because javascript is synchronous language, the loadnig state change would not delivered to the UI thread
      // before the actually decryption is complete.
      // So to make sure that the loading state changes, just wait very short time.
      await delay(10);
      await keyRingStore.unlock(password);
      await waitAccountInit();
      navigation.replace('Home');
    } catch (e) {
      console.log(e);

      setIsLoading(false);
      setError(e.message);
    }
  };

  //For a one-time biometric authentication
  useEffect(() => {
    if (
      !tryBiometricAutoOnce.current &&
      keychainStore.isBiometryOn &&
      keyRingStore.status === 'locked'
    ) {
      tryBiometricAutoOnce.current = true;
      (async () => {
        try {
          setIsBiometricLoading(true);
          // Because javascript is synchronous language, the loadnig state change would not delivered to the UI thread
          // So to make sure that the loading state changes, just wait very short time.
          await delay(10);

          await keychainStore.tryUnlockWithBiometry();
          await waitAccountInit();

          navigation.replace('Home');
        } catch (e) {
          console.log(e);
        } finally {
          setIsBiometricLoading(false);
        }
      })();
    }
  }, [
    keyRingStore.status,
    keychainStore,
    keychainStore.isBiometryOn,
    navigation,
    waitAccountInit,
  ]);

  return (
    <PageWithScrollView
      backgroundMode={'default'}
      contentContainerStyle={style.get('flex-grow-1')}
      style={style.flatten(['padding-x-24'])}>
      <Box style={{flex: 1}} alignX="center" alignY="center">
        <Box style={{flex: 1}} />

        <LottieView
          source={require('../../public/assets/lottie/wallet/logo.json')}
          style={{width: 200, height: 155}}
        />

        <Text style={style.flatten(['h1', 'color-text-high'])}>
          <FormattedMessage id="page.unlock.paragraph-section.welcome-back" />
        </Text>

        <Gutter size={70} />

        <TextInput
          label={intl.formatMessage({
            id: 'page.unlock.bottom-section.password-input-label',
          })}
          value={password}
          containerStyle={{width: '100%'}}
          secureTextEntry={true}
          returnKeyType="done"
          onChangeText={setPassword}
          onSubmitEditing={async () => {
            await tryUnlock();
          }}
          error={
            error
              ? intl.formatMessage({id: 'error.invalid-password'})
              : undefined
          }
        />

        <Gutter size={34} />

        <Button
          text={intl.formatMessage({id: 'page.unlock.unlock-button'})}
          size="large"
          onPress={tryUnlock}
          loading={isLoading}
          containerStyle={{width: '100%'}}
        />

        <Gutter size={32} />

        {keychainStore.isBiometryOn ? (
          <TextButton
            text="Use Biometric Authentication"
            size="large"
            loading={isBiometricLoading}
            onPress={async () => {
              await tryBiometric();
            }}
          />
        ) : null}

        <Box style={{flex: 1}} />

        <TextButton
          color="faint"
          text={intl.formatMessage({
            id: 'page.unlock.forgot-password-button',
          })}
          size="large"
        />

        <Gutter size={32} />
      </Box>
    </PageWithScrollView>
  );
});