import { MysqlStore, MySqlSelectOption, MysqlOperateOption } from 'oak-db';
import { EntityDict, Context, StorageSchema, SelectionResult, Trigger, Checker, SelectRowShape, RowStore } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { MySQLConfiguration } from 'oak-db/lib/MySQL/types/Configuration';
export declare class DbStore<ED extends EntityDict & BaseEntityDict, Cxt extends Context<ED>> extends MysqlStore<ED, Cxt> {
    private executor;
    constructor(storageSchema: StorageSchema<ED>, contextBuilder: (scene?: string) => (store: RowStore<ED, Cxt>) => Cxt, mysqlConfiguration: MySQLConfiguration);
    protected cascadeUpdate<T extends keyof ED>(entity: T, operation: ED[T]['Create'] | ED[T]['Update'] | ED[T]['Remove'], context: Cxt, option: MysqlOperateOption): Promise<import("oak-domain/lib/types").OperationResult<ED>>;
    protected cascadeSelect<T extends keyof ED, S extends ED[T]["Selection"]>(entity: T, selection: S, context: Cxt, option: MySqlSelectOption): Promise<SelectRowShape<ED[T]['Schema'], S['data']>[]>;
    operate<T extends keyof ED>(entity: T, operation: ED[T]['Operation'], context: Cxt, option: MysqlOperateOption): Promise<import("oak-domain/lib/types").OperationResult<ED>>;
    select<T extends keyof ED, S extends ED[T]['Selection']>(entity: T, selection: S, context: Cxt, option: MySqlSelectOption): Promise<SelectionResult<ED[T]["Schema"], S["data"]>>;
    registerTrigger<T extends keyof ED>(trigger: Trigger<ED, T, Cxt>): void;
    registerChecker<T extends keyof ED>(checker: Checker<ED, T, Cxt>): void;
}
