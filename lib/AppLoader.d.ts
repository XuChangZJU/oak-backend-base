import { AppLoader as GeneralAppLoader, RowStore, Context, EntityDict } from "oak-domain/lib/types";
import { MySQLConfiguration } from 'oak-db/lib/MySQL/types/Configuration';
export declare class AppLoader<ED extends EntityDict, Cxt extends Context<ED>> extends GeneralAppLoader<ED, Cxt> {
    private dbStore;
    private aspectDict;
    private contextBuilder;
    constructor(path: string, contextBuilder: (scene?: string) => (store: RowStore<ED, Cxt>) => Cxt, dbConfig: MySQLConfiguration);
    mount(initialize?: true): Promise<void>;
    unmount(): Promise<void>;
    execAspect(name: string, context: Cxt, params?: any): Promise<any>;
    initialize(dropIfExists?: boolean): Promise<void>;
    getStore(): RowStore<ED, Cxt>;
}
