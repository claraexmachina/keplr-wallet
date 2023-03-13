import {
  ObservableChainQuery,
  ObservableChainQueryMap,
} from "../../chain-query";
import { BondStatus, Validators, Validator } from "./types";
import { ChainGetter } from "../../../chain";
import { computed, makeObservable, observable, runInAction } from "mobx";
import {
  ObservableQuery,
  QueryResponse,
  QuerySharedContext,
} from "../../../common";
import PQueue from "p-queue";
import { CoinPretty, Dec } from "@keplr-wallet/unit";
import { computedFn } from "mobx-utils";

interface KeybaseResult {
  status: {
    code: number;
    name: string;
  };
  them?: [
    {
      id?: string;
      pictures?: {
        primary?: {
          url?: string;
        };
      };
    }
  ];
}

/**
 * Fetch the validator's thumbnail from keybase if the identity exists.
 */
export class ObservableQueryValidatorThumbnail extends ObservableQuery<KeybaseResult> {
  /**
   * Throttle down fetching the thumbnail from Keybase.
   * If too many requests occurs at the same time, Keybase will reject these requests.
   * @protected
   */
  protected static fetchingThumbnailQueue: PQueue = new PQueue({
    concurrency: 3,
  });

  protected readonly validator: Validator;

  constructor(sharedContext: QuerySharedContext, validator: Validator) {
    super(
      sharedContext,
      "https://keybase.io/",
      `_/api/1.0/user/lookup.json?fields=pictures&key_suffix=${validator.description.identity}`
    );
    makeObservable(this);

    this.validator = validator;
  }

  protected override canFetch(): boolean {
    return this.validator.description.identity !== "";
  }

  protected override async fetchResponse(
    abortController: AbortController
  ): Promise<{ response: QueryResponse<KeybaseResult>; headers: any }> {
    return await ObservableQueryValidatorThumbnail.fetchingThumbnailQueue.add(
      () => {
        return super.fetchResponse(abortController);
      }
    );
  }

  @computed
  get thumbnail(): string {
    if (this.response?.data.status.code === 0) {
      if (this.response.data.them && this.response.data.them.length > 0) {
        return this.response.data.them[0].pictures?.primary?.url ?? "";
      }
    }

    return "";
  }
}

export class ObservableQueryValidatorsInner extends ObservableChainQuery<Validators> {
  @observable.shallow
  protected thumbnailMap: Map<string, ObservableQueryValidatorThumbnail> =
    new Map();

  constructor(
    sharedContext: QuerySharedContext,
    chainId: string,
    chainGetter: ChainGetter,
    protected readonly status: BondStatus
  ) {
    super(
      sharedContext,
      chainId,
      chainGetter,
      `/cosmos/staking/v1beta1/validators?pagination.limit=1000&status=${(() => {
        switch (status) {
          case BondStatus.Bonded:
            return "BOND_STATUS_BONDED";
          case BondStatus.Unbonded:
            return "BOND_STATUS_UNBONDED";
          case BondStatus.Unbonding:
            return "BOND_STATUS_UNBONDING";
          default:
            return "BOND_STATUS_UNSPECIFIED";
        }
      })()}`
    );
    makeObservable(this);
  }

  @computed
  get validators(): Validator[] {
    if (!this.response) {
      return [];
    }

    return this.response.data.validators;
  }

  readonly getValidator = computedFn(
    (validatorAddress: string): Validator | undefined => {
      const validators = this.validators;

      return validators.find(
        (val) => val.operator_address === validatorAddress
      );
    }
  );

  @computed
  get validatorsSortedByVotingPower(): Validator[] {
    const validators = this.validators;
    return validators.sort((v1, v2) => {
      return new Dec(v1.tokens).gt(new Dec(v2.tokens)) ? -1 : 1;
    });
  }

  readonly getValidatorThumbnail = computedFn(
    (operatorAddress: string): string => {
      const validators = this.validators;
      const validator = validators.find(
        (val) => val.operator_address === operatorAddress
      );
      if (!validator) {
        return "";
      }

      if (!validator.description.identity) {
        return "";
      }

      const identity = validator.description.identity;

      if (!this.thumbnailMap.has(identity)) {
        runInAction(() => {
          this.thumbnailMap.set(
            identity,
            new ObservableQueryValidatorThumbnail(this.sharedContext, validator)
          );
        });
      }

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return this.thumbnailMap.get(identity)!.thumbnail;
    }
  );

  /**
   * Return the validator's voting power as human friendly (considering the coin decimals).
   */
  readonly getValidatorShare = computedFn(
    (operatorAddress: string): CoinPretty | undefined => {
      const validators = this.validators;
      const validator = validators.find(
        (val) => val.operator_address === operatorAddress
      );
      if (!validator) {
        return;
      }

      const chainInfo = this.chainGetter.getChain(this.chainId);
      const stakeCurrency = chainInfo.stakeCurrency;

      const power = new Dec(validator.tokens).truncate();

      return new CoinPretty(stakeCurrency, power);
    }
  );
}

export class ObservableQueryValidators extends ObservableChainQueryMap<Validators> {
  constructor(
    sharedContext: QuerySharedContext,
    chainId: string,
    chainGetter: ChainGetter
  ) {
    super(sharedContext, chainId, chainGetter, (status: string) => {
      return new ObservableQueryValidatorsInner(
        this.sharedContext,
        this.chainId,
        this.chainGetter,
        status as BondStatus
      );
    });
  }

  getQueryStatus(
    status: BondStatus = BondStatus.Bonded
  ): ObservableQueryValidatorsInner {
    return this.get(status) as ObservableQueryValidatorsInner;
  }
}
