import { EntityDict as BaseEntityDict } from 'oak-domain/lib/base-app-domain';
import { EntityDict, OperationResult, Trigger } from 'oak-domain/lib/types';
import { BackendRuntimeContext } from 'oak-frontend-base/lib/context/BackendRuntimeContext';
import { AppLoader } from './AppLoader';
import { DbStore } from './DbStore';
import { Namespace } from 'socket.io';
import { Socket } from 'socket.io-client';
export declare class ClusterAppLoader<ED extends EntityDict & BaseEntityDict, Cxt extends BackendRuntimeContext<ED>> extends AppLoader<ED, Cxt> {
    protected socket: Socket;
    private csTriggers;
    private connect;
    private sub;
    constructor(path: string, contextBuilder: (scene?: string) => (store: DbStore<ED, Cxt>) => Promise<Cxt>, nsDs: Namespace, nsServer: Namespace, socketPath: string);
    protected registerTrigger(trigger: Trigger<ED, keyof ED, Cxt>): void;
    protected operateInWatcher<T extends keyof ED>(entity: T, operation: ED[T]['Update'], context: Cxt): Promise<OperationResult<ED>>;
    protected selectInWatcher<T extends keyof ED>(entity: T, selection: ED[T]['Selection'], context: Cxt): Promise<Partial<ED[T]['Schema']>[]>;
}
