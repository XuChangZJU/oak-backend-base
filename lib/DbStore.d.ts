import { MysqlStore, MySqlSelectOption, MysqlOperateOption } from 'oak-db';
import { EntityDict, StorageSchema, Trigger, Checker, SelectOption, SelectFreeEntities, UpdateFreeDict, AuthDeduceRelationMap, VolatileTrigger, OperateOption } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { MySQLConfiguration } from 'oak-db/lib/MySQL/types/Configuration';
import { BackendRuntimeContext } from 'oak-frontend-base/lib/context/BackendRuntimeContext';
import { AsyncContext, AsyncRowStore } from 'oak-domain/lib/store/AsyncRowStore';
export declare class DbStore<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends MysqlStore<ED, Cxt> implements AsyncRowStore<ED, Cxt> {
    private executor;
    private relationAuth;
    constructor(storageSchema: StorageSchema<ED>, contextBuilder: (scene?: string) => Promise<Cxt>, mysqlConfiguration: MySQLConfiguration, authDeduceRelationMap: AuthDeduceRelationMap<ED>, selectFreeEntities?: SelectFreeEntities<ED>, updateFreeDict?: UpdateFreeDict<ED>, onVolatileTrigger?: <T extends keyof ED>(entity: T, trigger: VolatileTrigger<ED, T, Cxt>, ids: string[], cxtStr: string, option: OperateOption) => Promise<void>);
    protected cascadeUpdateAsync<T extends keyof ED>(entity: T, operation: ED[T]['Operation'], context: AsyncContext<ED>, option: MysqlOperateOption): Promise<import("oak-domain/lib/types").OperationResult<ED>>;
    operate<T extends keyof ED>(entity: T, operation: ED[T]['Operation'], context: Cxt, option: MysqlOperateOption): Promise<import("oak-domain/lib/types").OperationResult<ED>>;
    select<T extends keyof ED>(entity: T, selection: ED[T]['Selection'], context: Cxt, option: MySqlSelectOption): Promise<Partial<ED[T]["Schema"]>[]>;
    count<T extends keyof ED>(entity: T, selection: Pick<ED[T]['Selection'], 'filter' | 'count'>, context: Cxt, option: SelectOption): Promise<number>;
    registerTrigger<T extends keyof ED>(trigger: Trigger<ED, T, Cxt>): void;
    registerChecker<T extends keyof ED>(checker: Checker<ED, T, Cxt>): void;
    setOnVolatileTrigger(onVolatileTrigger: <T extends keyof ED>(entity: T, trigger: VolatileTrigger<ED, T, Cxt>, ids: string[], cxtStr: string, option: OperateOption) => Promise<void>): void;
    execVolatileTrigger<T extends keyof ED>(entity: T, name: string, ids: string[], context: Cxt, option: OperateOption): Promise<void>;
    checkpoint(ts: number): Promise<number>;
}
