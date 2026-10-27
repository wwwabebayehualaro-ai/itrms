// The effect registry (task 0.19a): marked providers are found by key, a key is registered once, and a slice's listed
// effects come from the marks.
import { Injectable, Module } from '@nestjs/common';
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
