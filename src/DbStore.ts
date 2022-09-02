import { MysqlStore, MySqlSelectOption, MysqlOperateOption } from 'oak-db';
import { EntityDict, Context, StorageSchema, SelectionResult, Trigger, Checker, SelectRowShape, RowStore } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { TriggerExecutor } from 'oak-domain/lib/store/TriggerExecutor';
import { MySQLConfiguration, } from 'oak-db/lib/MySQL/types/Configuration';


export class DbStore<ED extends EntityDict & BaseEntityDict, Cxt extends Context<ED>> extends MysqlStore<ED, Cxt> {
    private executor: TriggerExecutor<ED, Cxt>;

    constructor(storageSchema: StorageSchema<ED>, contextBuilder: (scene?: string) => (store: RowStore<ED, Cxt>) => Cxt, mysqlConfiguration: MySQLConfiguration) {
        super(storageSchema, mysqlConfiguration);
        this.executor = new TriggerExecutor(async (scene) => contextBuilder(scene)(this));
    }


    protected async cascadeUpdate<T extends keyof ED>(entity: T, operation: ED[T]['Create'] | ED[T]['Update'] | ED[T]['Remove'], context: Cxt, option: MysqlOperateOption) {
        if (!option.blockTrigger) {
            await this.executor.preOperation(entity, operation, context, option);
        }
        const result = super.cascadeUpdate(entity, operation, context, option);
        if (!option.blockTrigger) {
            await this.executor.postOperation(entity, operation, context, option);
        }
        return result;
    }

    protected async cascadeSelect<T extends keyof ED, S extends ED[T]["Selection"]>(entity: T, selection: S, context: Cxt, option: MySqlSelectOption): Promise<SelectRowShape<ED[T]['Schema'], S['data']>[]> {
        const selection2 = Object.assign({
            action: 'select',
        }, selection) as ED[T]['Operation'];

        if (!option.blockTrigger) {
            await this.executor.preOperation(entity, selection2, context, option);
        }
        const result = await super.cascadeSelect(entity, selection2 as any, context, option);
        if (!option.blockTrigger) {
            await this.executor.postOperation(entity, selection2, context, option, result);
        }
        return result;
    }

    async operate<T extends keyof ED>(
        entity: T,
        operation: ED[T]['Operation'],
        context: Cxt,
        option: MysqlOperateOption
    ) {
        const autoCommit = !context.getCurrentTxnId();
        let result;
        if (autoCommit) {
            await context.begin();
        }
        try {
            result = await super.operate(entity, operation, context, option);
        }
        catch (err) {
            await context.rollback();
            throw err;
        }
        if (autoCommit) {
            await context.commit();
        }
        return result;
    }

    async select<T extends keyof ED, S extends ED[T]['Selection']>(
        entity: T,
        selection: S,
        context: Cxt,
        option: MySqlSelectOption
    ) {
        const autoCommit = !context.getCurrentTxnId();
        if (autoCommit) {
            await context.begin();
        }
        let result: SelectionResult<ED[T]['Schema'], S['data']>;

        try {
            result = await super.select(entity, selection, context, option);
        }
        catch (err) {
            await context.rollback();
            throw err;
        }
        if (autoCommit) {
            await context.commit();
        }
        return result;
    }

    registerTrigger<T extends keyof ED>(trigger: Trigger<ED, T, Cxt>) {
        this.executor.registerTrigger(trigger);
    }

    registerChecker<T extends keyof ED>(checker: Checker<ED, T, Cxt>) {
        this.executor.registerChecker(checker);
    }
}