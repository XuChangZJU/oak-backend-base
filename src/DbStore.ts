import { MysqlStore, MySqlSelectOption, MysqlOperateOption } from 'oak-db';
import { EntityDict, Context, StorageSchema,  Trigger, Checker,  RowStore } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { TriggerExecutor } from 'oak-domain/lib/store/TriggerExecutor';
import { MySQLConfiguration, } from 'oak-db/lib/MySQL/types/Configuration';
import { AsyncContext, AsyncRowStore } from 'oak-domain/lib/store/AsyncRowStore';


export class DbStore<ED extends EntityDict & BaseEntityDict, Cxt extends AsyncContext<ED>> extends MysqlStore<ED, Cxt> implements AsyncRowStore<ED, Cxt> {
    private executor: TriggerExecutor<ED>;

    constructor(storageSchema: StorageSchema<ED>, contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<AsyncContext<ED>>, mysqlConfiguration: MySQLConfiguration) {
        super(storageSchema, mysqlConfiguration);
        this.executor = new TriggerExecutor((scene) => contextBuilder(scene)(this));
    }


    protected async cascadeUpdateAsync<T extends keyof ED>(entity: T, operation: ED[T]['Operation'], context: AsyncContext<ED>, option: MysqlOperateOption) {
        if (!option.blockTrigger) {
            await this.executor.preOperation(entity, operation, context, option);
        }
        const result = super.cascadeUpdateAsync(entity, operation, context, option);
        if (!option.blockTrigger) {
            await this.executor.postOperation(entity, operation, context, option);
        }
        return result;
    }

    protected async cascadeSelectAsync<T extends keyof ED>(entity: T, selection: ED[T]["Selection"], context: AsyncContext<ED>, option: MySqlSelectOption): Promise<Partial<ED[T]['Schema']>[]> {
        const selection2 = Object.assign({
            action: 'select',
        }, selection) as ED[T]['Operation'];

        if (!option.blockTrigger) {
            await this.executor.preOperation(entity, selection2, context, option);
        }
        const result = await super.cascadeSelectAsync(entity, selection2, context, option);
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

    async select<T extends keyof ED>(
        entity: T,
        selection: ED[T]['Selection'],
        context: Cxt,
        option: MySqlSelectOption
    ) {
        const autoCommit = !context.getCurrentTxnId();
        if (autoCommit) {
            await context.begin();
        }
        let result: Partial<ED[T]['Schema']>[];

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