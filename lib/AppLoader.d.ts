/// <reference types="node" />
import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { AppLoader as GeneralAppLoader, Trigger, EntityDict, Watcher, OpRecord, OperationResult } from "oak-domain/lib/types";
import { DbStore } from "./DbStore";
import { BackendRuntimeContext } from 'oak-frontend-base/lib/context/BackendRuntimeContext';
import { IncomingHttpHeaders, IncomingMessage } from 'http';
import { Namespace } from 'socket.io';
import DataSubscriber from './cluster/DataSubscriber';
import Synchronizer from './Synchronizer';
export declare class AppLoader<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends GeneralAppLoader<ED, Cxt> {
    protected dbStore: DbStore<ED, Cxt>;
    private aspectDict;
    private externalDependencies;
    protected dataSubscriber?: DataSubscriber<ED, Cxt>;
    protected synchronizer?: Synchronizer<ED, Cxt>;
    protected contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>;
    private requireSth;
    protected makeContext(cxtStr?: string, headers?: IncomingHttpHeaders): Promise<Cxt>;
    /**
     * 后台启动的configuration，统一放在这里读取
     */
    private getConfiguration;
    constructor(path: string, contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>, ns?: Namespace, nsServer?: Namespace);
    protected registerTrigger(trigger: Trigger<ED, keyof ED, Cxt>): void;
    initTriggers(): void;
    mount(initialize?: true): Promise<void>;
    unmount(): Promise<void>;
    execAspect(name: string, headers?: IncomingHttpHeaders, contextString?: string, params?: any): Promise<{
        opRecords: OpRecord<ED>[];
        result: any;
        message?: string;
    }>;
    initialize(dropIfExists?: boolean): Promise<void>;
    getStore(): DbStore<ED, Cxt>;
    getEndpoints(prefix: string): [string, "post" | "get" | "put" | "delete", string, (params: Record<string, string>, headers: IncomingHttpHeaders, req: IncomingMessage, body?: any) => Promise<any>][];
    protected operateInWatcher<T extends keyof ED>(entity: T, operation: ED[T]['Update'], context: Cxt): Promise<OperationResult<ED>>;
    protected selectInWatcher<T extends keyof ED>(entity: T, selection: ED[T]['Selection'], context: Cxt): Promise<Partial<ED[T]["Schema"]>[]>;
    protected execWatcher(watcher: Watcher<ED, keyof ED, Cxt>): Promise<OperationResult<ED> | undefined>;
    startWatchers(): void;
    startTimers(): void;
    execStartRoutines(): Promise<void>;
    execRoutine(routine: (context: Cxt) => Promise<void>): Promise<void>;
}
