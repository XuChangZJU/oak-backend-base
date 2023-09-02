import { EntityDict } from 'oak-domain/lib/base-app-domain';
import { AsyncContext } from 'oak-domain/lib/store/AsyncRowStore';

class Context extends AsyncContext<EntityDict> {
    async refineOpRecords(): Promise<void> {
        return;
    }
    isRoot(): boolean {
        return true;
    }
    getCurrentUserId(allowUnloggedIn?: boolean | undefined): string | undefined {
        throw 'bbb';
    }
    toString(): string {
        return '';
    }
    allowUserUpdate(): boolean {
        throw new Error('Method not implemented.');
    }
    openRootMode(): () => void {
        return () => undefined;
    }
};

export default Context;