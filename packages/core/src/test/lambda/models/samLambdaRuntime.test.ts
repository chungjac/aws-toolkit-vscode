/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert'
import { Runtime } from 'aws-sdk/clients/lambda'
import {
    compareSamLambdaRuntime,
    getDependencyManager,
    getFamily,
    samZipLambdaRuntimes,
    RuntimeFamily,
    samImageLambdaRuntimes,
    samLambdaCreatableRuntimes,
    getNodeMajorVersion,
    nodeJsRuntimes,
} from '../../../lambda/models/samLambdaRuntime'

describe('compareSamLambdaRuntime', async function () {
    const scenarios: {
        lowerRuntime: Runtime
        higherRuntime: Runtime
    }[] = [
        { lowerRuntime: 'nodejs14.x', higherRuntime: 'nodejs16.x' },
        { lowerRuntime: 'nodejs16.x', higherRuntime: 'nodejs16.x (Image)' },
        { lowerRuntime: 'nodejs14.x (Image)', higherRuntime: 'nodejs16.x' },
    ]

    for (const scenario of scenarios) {
        it(`${scenario.lowerRuntime} < ${scenario.higherRuntime}`, () => {
            assert.ok(compareSamLambdaRuntime(scenario.lowerRuntime, scenario.higherRuntime) < 0)
        })

        it(`${scenario.higherRuntime} > ${scenario.lowerRuntime}`, () => {
            assert.ok(compareSamLambdaRuntime(scenario.higherRuntime, scenario.lowerRuntime) > 0)
        })
    }
})

describe('getDependencyManager', function () {
    it('all runtimes are handled', function () {
        for (const runtime of samZipLambdaRuntimes) {
            assert.ok(getDependencyManager(runtime))
        }
    })
    it('throws on deprecated runtimes', function () {
        assert.throws(() => getDependencyManager('nodejs'))
    })
    it('throws on unknown runtimes', function () {
        assert.throws(() => getDependencyManager('BASIC'))
    })
})

describe('getFamily', function () {
    it('unknown runtime name', function () {
        assert.strictEqual(getFamily('foo'), RuntimeFamily.Unknown)
    })
    it('handles all known runtimes', function () {
        for (const runtime of samZipLambdaRuntimes) {
            assert.notStrictEqual(getFamily(runtime), RuntimeFamily.Unknown)
        }
    })
    it('throws on deprecated runtimes', function () {
        assert.throws(() => getFamily('nodejs'))
    })
})

describe('runtimes', function () {
    it('cloud9', function () {
        assert.deepStrictEqual(samLambdaCreatableRuntimes(true).toArray().sort(), [
            'nodejs14.x',
            'nodejs16.x',
            'nodejs18.x',
            'nodejs20.x',
            'nodejs22.x',
            'python3.10',
            'python3.11',
            'python3.12',
            'python3.13',
            'python3.7',
            'python3.8',
            'python3.9',
        ])
        assert.deepStrictEqual(samImageLambdaRuntimes(true).toArray().sort(), [
            'nodejs14.x',
            'nodejs16.x',
            'nodejs18.x',
            'nodejs20.x',
            'nodejs22.x',
            'python3.10',
            'python3.11',
            'python3.12',
            'python3.13',
            'python3.7',
            'python3.8',
            'python3.9',
        ])
    })
    it('vscode', function () {
        assert.deepStrictEqual(samLambdaCreatableRuntimes(false).toArray().sort(), [
            'dotnet6',
            'dotnet8',
            'go1.x',
            'java11',
            'java17',
            'java21',
            'java8',
            'java8.al2',
            'nodejs14.x',
            'nodejs16.x',
            'nodejs18.x',
            'nodejs20.x',
            'nodejs22.x',
            'python3.10',
            'python3.11',
            'python3.12',
            'python3.13',
            'python3.7',
            'python3.8',
            'python3.9',
        ])
        assert.deepStrictEqual(samImageLambdaRuntimes(false).toArray().sort(), [
            'dotnet5.0',
            'dotnet6',
            'dotnet8',
            'go1.x',
            'java11',
            'java17',
            'java21',
            'java8',
            'java8.al2',
            'nodejs14.x',
            'nodejs16.x',
            'nodejs18.x',
            'nodejs20.x',
            'nodejs22.x',
            'python3.10',
            'python3.11',
            'python3.12',
            'python3.13',
            'python3.7',
            'python3.8',
            'python3.9',
        ])
    })
})

describe('getNodeMajorVersion()', () => {
    it('returns node version', () => {
        assert.strictEqual(getNodeMajorVersion('nodejs12.x'), 12)
        assert.strictEqual(getNodeMajorVersion('nodejs18.x'), 18)
    })

    it('returns undefined on invalid input', () => {
        const version = getNodeMajorVersion('python12.x')
        assert.strictEqual(version, undefined)
    })

    describe('extracts a version from existing runtimes', function () {
        for (const versionString of nodeJsRuntimes) {
            it(`extracts from runtime: "${versionString}"`, () => {
                const version = getNodeMajorVersion(versionString)
                assert(version !== undefined)
                assert(0 < version && version < 999)
            })
        }
    })
})
