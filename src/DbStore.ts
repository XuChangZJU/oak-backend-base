import { MysqlStore, MySqlSelectOption, MysqlOperateOption } from 'oak-db';
import { EntityDict, StorageSchema, Trigger, Checker, SelectOption, SelectFreeEntities, UpdateFreeDict, AuthDeduceRelationMap, VolatileTrigger, OperateOption } from 'oak-domain/lib/types';
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { TriggerExecutor } from 'oak-domain/lib/store/TriggerExecutor';
import { MySQLConfiguration, } from 'oak-db/lib/MySQL/types/Configuration';
import { BackendRuntimeContext } from 'oak-frontend-base';
import { AsyncContext, AsyncRowStore } from 'oak-domain/lib/store/AsyncRowStore';
import { RelationAuth } from 'oak-domain/lib/store/RelationAuth';


export class DbStore<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends MysqlStore<ED, Cxt> implements AsyncRowStore<ED, Cxt> {
    private executor: TriggerExecutor<ED, Cxt>;
    private relationAuth: RelationAuth<ED>;

    constructor(
        storageSchema: StorageSchema<ED>, 
        contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>, 
        mysqlConfiguration: MySQLConfiguration,
        authDeduceRelationMap: AuthDeduceRelationMap<ED>,
        selectFreeEntities: SelectFreeEntities<ED> = [],
        updateFreeDict: UpdateFreeDict<ED> = {},
        onVolatileTrigger?: <T extends keyof ED>(entity: T, trigger: VolatileTrigger<ED, T, Cxt>, ids: string[], cxtStr: string, option: OperateOption) => Promise<void>) {
        super(storageSchema, mysqlConfiguration);
        this.executor = new TriggerExecutor((scene) => contextBuilder(scene)(this), undefined, onVolatileTrigger);
        this.relationAuth = new RelationAuth(storageSchema, authDeduceRelationMap, selectFreeEntities, updateFreeDict);
    }

    protected async cascadeUpdateAsync<T extends keyof ED>(entity: T, operation: ED[T]['Operation'], context: AsyncContext<ED>, option: MysqlOperateOption) {
        // 如果是在modi处理过程中，所有的trigger也可以延时到apply时再处理（这时候因为modi中的数据并不实际存在，处理会有问题）
        if (!option.blockTrigger) {
            await this.executor.preOperation(entity, operation, context as Cxt, option);
        }
        const result = await super.cascadeUpdateAsync(entity, operation, context, option);
        if (!option.blockTrigger) {
            await this.executor.postOperation(entity, operation, context as Cxt, option);
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
            await this.relationAuth.checkRelationAsync(entity, operation, context);
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

        // select的trigger应加在根select之前，cascade的select不加处理
        Object.assign(selection, {
            action: 'select',
        });
        if (!option.blockTrigger) {
            await this.executor.preOperation(entity, selection as ED[T]['Operation'], context, option);
        }
        if (!option.dontCollect) {
            await this.relationAuth.checkRelationAsync(entity, selection, context);
        }
        try {
            result = await super.select(entity, selection, context, option);

            if (!option.blockTrigger) {
                await this.executor.postOperation(entity, selection as ED[T]['Operation']
                , context, option, result);
            }
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

    async count<T extends keyof ED>(entity: T, selection: Pick<ED[T]['Selection'], 'filter' | 'count'>, context: Cxt, option: SelectOption): Promise<number> {
        const autoCommit = !context.getCurrentTxnId();
        let result;
        if (autoCommit) {
            await context.begin();
        }
        try {
            // count不用检查权限，因为检查权限中本身要用到count
            // const selection2 = Object.assign({
            //     action: 'select',
            // }, selection) as ED[T]['Operation'];

            // await this.relationAuth.checkRelationAsync(entity, selection2, context);
            // if (!option.blockTrigger) {
            //     await this.executor.preOperation(entity, selection2, context, option);
            // }
            result = await super.count(entity, selection, context, option);
            /*  count应该不存在后trigger吧
            if (!option.blockTrigger) {
                await this.executor.postOperation(entity, selection2, context, option);
            } */
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

    setOnVolatileTrigger(
        onVolatileTrigger: <T extends keyof ED>(
            entity: T,
            trigger: VolatileTrigger<ED, T, Cxt>, 
            ids: string[], 
            cxtStr: string,
            option: OperateOption) => Promise<void>
    ) {
        this.executor.setOnVolatileTrigger(onVolatileTrigger);
    }

    async execVolatileTrigger<T extends keyof ED>(
        entity: T,
        name: string,
        ids: string[],
        context: Cxt,
        option: OperateOption
    ) {
        return this.executor.execVolatileTrigger(entity, name, ids, context, option);
    }

    checkpoint(ts: number) {
        return this.executor.checkpoint(ts);
    }
}