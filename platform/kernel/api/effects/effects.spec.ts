// The effect registry (task 0.19a): marked providers are found by key, a key is registered once, and a slice's listed
// effects come from the marks.
import { Injectable, Module, Scope } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

import { Effect, effectKeyOf, effectKeys, EffectRegistry, type EffectRun, type WorkflowEffect } from './index';

@Injectable()
@Effect('competency.issueLicence')
class IssueLicence implements WorkflowEffect {
    run({ argument }: EffectRun) {
        return Promise.resolve({ facts: { issued: argument ?? true } });
    }
}

@Injectable()
@Effect('fees.createPaymentOrder')
class CreatePaymentOrder implements WorkflowEffect {
    run() {
        return Promise.resolve();
    }
}

@Injectable()
class NotAnEffect {}

@Injectable()
@Effect('competency.issueLicence')
class IssueLicenceAgain implements WorkflowEffect {
    run() {
        return Promise.resolve();
    }
}

@Injectable({ scope: Scope.REQUEST })
@Effect('competency.perRequest')
class PerRequest implements WorkflowEffect {
    run() {
        return Promise.resolve();
    }
}

async function registryWith(...providers: (new (...args: never[]) => unknown)[]) {
    @Module({ providers })
    class Slice {}
    const moduleRef = await Test.createTestingModule({
        imports: [DiscoveryModule, Slice],
        providers: [EffectRegistry]
    }).compile();
    await moduleRef.init();
    return moduleRef.get(EffectRegistry);
}

describe('effects', () => {
    it('finds the marked providers by key, and nothing else', async () => {
        const registry = await registryWith(IssueLicence, CreatePaymentOrder, NotAnEffect);
        expect([...registry.keys()].sort()).toEqual(['competency.issueLicence', 'fees.createPaymentOrder']);
        const effect = registry.get('competency.issueLicence');
        expect(effect).toBeInstanceOf(IssueLicence);
        expect(registry.get('competency.unknown')).toBeUndefined();
    });

    it('refuses a key registered twice', async () => {
        await expect(registryWith(IssueLicence, IssueLicenceAgain)).rejects.toThrow(
            'The effect competency.issueLicence is registered twice'
        );
    });

    it('refuses a request-scoped effect (its static instance would be an unconstructed prototype)', async () => {
        await expect(registryWith(PerRequest)).rejects.toThrow('The effect competency.perRequest must be a singleton');
    });

    it('lists a slice’s effect keys from the marks, and refuses an unmarked class', () => {
        expect(effectKeys([IssueLicence, CreatePaymentOrder])).toEqual([
            'competency.issueLicence',
            'fees.createPaymentOrder'
        ]);
        expect(effectKeyOf(NotAnEffect)).toBeUndefined();
        expect(() => effectKeys([NotAnEffect as never])).toThrow(
            'NotAnEffect is listed as an effect but has no @Effect mark'
        );
    });

    it('refuses a key that is not <module>.<name>', () => {
        expect(() => Effect('issueLicence')).toThrow('an effect key is <module>.<name>');
        expect(() => Effect('Competency.issueLicence')).toThrow();
        // the manifest's form: dots, underscores and hyphens in the name
        expect(() => Effect('integrations.national.requestLicence')).not.toThrow();
    });
});

// ---- what an effect takes, and what it needs before it (task 1.4b2)

@Injectable()
@Effect('vehicles.checkHolds', { argument: { values: ['transfer', 'replacement'], required: true } })
class CheckHolds implements WorkflowEffect {
    run() {
        return Promise.resolve();
    }
}

@Injectable()
@Effect('competency.giveIt', { requiresBefore: ['vehicles.checkHolds:transfer'] })
class GiveIt implements WorkflowEffect {
    run() {
        return Promise.resolve();
    }
}

@Injectable()
@Effect('competency.giveOther', { requiresBefore: ['vehicles.checkHolds:sale'] })
class GiveOther implements WorkflowEffect {
    run() {
        return Promise.resolve();
    }
}

@Injectable()
@Effect('competency.giveBare', { requiresBefore: ['vehicles.checkHolds'] })
class GiveBare implements WorkflowEffect {
    run() {
        return Promise.resolve();
    }
}

describe('what an effect takes and needs', () => {
    it('keeps the arguments and the references a transition needs before it', async () => {
        const registry = await registryWith(CheckHolds, GiveIt);
        expect(registry.argumentOf('vehicles.checkHolds')).toEqual({
            values: ['transfer', 'replacement'],
            required: true
        });
        expect(registry.argumentOf('competency.giveIt')).toBeUndefined();
        expect(registry.requiresBefore('competency.giveIt')).toEqual(['vehicles.checkHolds:transfer']);
        expect(registry.requiresBefore('vehicles.checkHolds')).toEqual([]);
    });

    it('refuses to start when what is required is not installed, takes no such argument, or needs one', async () => {
        await expect(registryWith(GiveIt)).rejects.toThrow('which no installed module provides');
        await expect(registryWith(CheckHolds, GiveOther)).rejects.toThrow(
            'an argument vehicles.checkHolds does not take'
        );
        await expect(registryWith(CheckHolds, GiveBare)).rejects.toThrow(
            'an argument vehicles.checkHolds does not take'
        );
    });

    it('refuses a mark whose reference or argument list is not one', () => {
        expect(() => Effect('competency.x', { requiresBefore: ['not a reference'] })).toThrow(
            'is not an effect reference'
        );
        expect(() => Effect('competency.x', { argument: { values: [] } })).toThrow('names the values it takes');
    });
});
