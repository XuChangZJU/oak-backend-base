import { RowStore } from 'oak-domain/lib/types';
import { GeneralRuntimeContext } from 'oak-general-business';
import { EntityDict } from 'oak-general-business/lib/general-app-domain';
export declare class Context<ED extends EntityDict> extends GeneralRuntimeContext<ED> {
    static FromCxtStr(cxtStr?: string): <ED extends EntityDict>(store: RowStore<ED, Context<ED>>) => Context<ED>;
}
