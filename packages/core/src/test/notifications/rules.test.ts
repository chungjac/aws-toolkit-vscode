/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import assert from 'assert'
import { RuleEngine, getRuleContext } from '../../notifications/rules'
import { DisplayIf, ToolkitNotification, RuleContext } from '../../notifications/types'
import globals from '../../shared/extensionGlobals'
import { Connection, scopesCodeCatalyst } from '../../auth/connection'
import { getOperatingSystem } from '../../shared/telemetry/util'
import { getAuthFormIdsFromConnection } from '../../auth/utils'
import { amazonQScopes } from '../../codewhisperer'
import { builderIdStartUrl } from '../../auth/sso/constants'

describe('Notifications Rule Engine', function () {
    const context: RuleContext = {
        ideVersion: '1.83.0',
        extensionVersion: '1.20.0',
        os: 'LINUX',
        computeEnv: 'local',
        authTypes: ['builderId'],
        authRegions: ['us-east-1'],
        authStates: ['connected'],
        authScopes: ['codewhisperer:completions', 'codewhisperer:analysis'],
        activeExtensions: ['ext1', 'ext2'],
    }

    const ruleEngine = new RuleEngine(context)

    function buildNotification(criteria: Omit<DisplayIf, 'extensionId'>): ToolkitNotification {
        return {
            id: 'bd22f116-edd4-4e80-8f1f-ec7340159016',
            displayIf: { extensionId: globals.context.extension.id, ...criteria },
            uiRenderInstructions: {
                content: {
                    [`en-US`]: {
                        title: 'Something crazy is happening!',
                        description: 'Something crazy is happening! Please update your extension.',
                    },
                },
                onReceive: 'toast',
                onClick: {
                    type: 'openUrl',
                    url: 'https://aws.amazon.com/visualstudiocode/',
                },
            },
        }
    }

    it('should display notification with no criteria', function () {
        const notification = buildNotification({})
        assert.equal(ruleEngine.shouldDisplayNotification(notification), true)
    })

    it('should display notification with version exact criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    ideVersion: {
                        type: 'exactMatch',
                        values: ['1.82.0', '1.83.0'],
                    },
                })
            ),
            true
        )

        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    extensionVersion: {
                        type: 'exactMatch',
                        values: ['1.19.0', '1.20.0'],
                    },
                })
            ),
            true
        )
    })

    it('should NOT display notification with invalid version exact criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    ideVersion: {
                        type: 'exactMatch',
                        values: ['1.82.0', '1.84.0'],
                    },
                })
            ),
            false
        )

        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    extensionVersion: {
                        type: 'exactMatch',
                        values: ['1.19.0', '1.21.0'],
                    },
                })
            ),
            false
        )
    })

    it('should display notification with version range criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    extensionVersion: {
                        type: 'range',
                        lowerInclusive: '1.20.0',
                        upperExclusive: '1.21.0',
                    },
                })
            ),
            true
        )

        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    extensionVersion: {
                        type: 'range',
                        upperExclusive: '1.23.0',
                    },
                })
            ),
            true
        )
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    extensionVersion: {
                        type: 'range',
                        lowerInclusive: '-inf',
                        upperExclusive: '1.23.0',
                    },
                })
            ),
            true
        )

        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    extensionVersion: {
                        type: 'range',
                        lowerInclusive: '1.0.0',
                    },
                })
            ),
            true
        )
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    extensionVersion: {
                        type: 'range',
                        lowerInclusive: '1.0.0',
                        upperExclusive: '+inf',
                    },
                })
            ),
            true
        )

        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    extensionVersion: {
                        type: 'range',
                        lowerInclusive: '-inf',
                        upperExclusive: '+inf',
                    },
                })
            ),
            true
        )
    })

    it('should NOT display notification with invalid version range criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    extensionVersion: {
                        type: 'range',
                        lowerInclusive: '1.18.0',
                        upperExclusive: '1.20.0',
                    },
                })
            ),
            false
        )
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    extensionVersion: {
                        type: 'range',
                        lowerInclusive: '-inf',
                        upperExclusive: '1.20.0',
                    },
                })
            ),
            false
        )
    })

    it('should display notification with version OR criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    extensionVersion: {
                        type: 'or',
                        clauses: [
                            {
                                type: 'exactMatch',
                                values: ['1.18.0', '1.19.0'],
                            },
                            {
                                type: 'range',
                                lowerInclusive: '1.18.0',
                                upperExclusive: '1.21.0',
                            },
                        ],
                    },
                })
            ),
            true
        )
    })

    it('should NOT display notification with invalid version OR criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    extensionVersion: {
                        type: 'or',
                        clauses: [
                            {
                                type: 'exactMatch',
                                values: ['1.18.0', '1.19.0'],
                            },
                            {
                                type: 'range',
                                lowerInclusive: '1.18.0',
                                upperExclusive: '1.20.0',
                            },
                        ],
                    },
                })
            ),
            false
        )
    })

    it('should display notification for OS criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [{ type: 'OS', values: ['LINUX', 'MAC'] }],
                })
            ),
            true
        )
    })

    it('should NOT display notification for invalid OS criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [{ type: 'OS', values: ['MAC'] }],
                })
            ),
            false
        )
    })

    it('should display notification for ComputeEnv criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [{ type: 'ComputeEnv', values: ['local', 'ec2'] }],
                })
            ),
            true
        )
    })

    it('should NOT display notification for invalid ComputeEnv criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [{ type: 'ComputeEnv', values: ['ec2'] }],
                })
            ),
            false
        )
    })

    it('should display notification for AuthType criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [{ type: 'AuthType', values: ['builderId', 'identityCenter'] }],
                })
            ),
            true
        )
    })

    it('should NOT display notification for invalid AuthType criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [{ type: 'AuthType', values: ['identityCenter'] }],
                })
            ),
            false
        )
    })

    it('should display notification for AuthRegion criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [{ type: 'AuthRegion', values: ['us-east-1', 'us-west-2'] }],
                })
            ),
            true
        )
    })

    it('should NOT display notification for invalid AuthRegion criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [{ type: 'AuthRegion', values: ['us-west-2'] }],
                })
            ),
            false
        )
    })

    it('should display notification for AuthState criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [{ type: 'AuthState', values: ['connected'] }],
                })
            ),
            true
        )
    })

    it('should NOT display notification for invalid AuthState criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [{ type: 'AuthState', values: ['notConnected'] }],
                })
            ),
            false
        )
    })

    it('should display notification for AuthScopes criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [
                        { type: 'AuthScopes', values: ['codewhisperer:completions', 'codewhisperer:analysis'] },
                    ],
                })
            ),
            true
        )
    })

    it('should NOT display notification for invalid AuthScopes criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [{ type: 'AuthScopes', values: ['codewhisperer:completions'] }],
                })
            ),
            false
        )
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [
                        {
                            type: 'AuthScopes',
                            values: ['codewhisperer:completions', 'codewhisperer:analysis', 'sso:account:access'],
                        },
                    ],
                })
            ),
            false
        )
    })

    it('should display notification for ActiveExtensions criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [{ type: 'ActiveExtensions', values: ['ext1', 'ext2'] }],
                })
            ),
            true
        )
    })

    it('should NOT display notification for invalid ActiveExtensions criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    additionalCriteria: [{ type: 'ActiveExtensions', values: ['ext1', 'ext2', 'unknownExtension'] }],
                })
            ),
            false
        )
    })

    it('should display notification for combined criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    ideVersion: {
                        type: 'or',
                        clauses: [
                            {
                                type: 'range',
                                lowerInclusive: '1.70.0',
                                upperExclusive: '1.81.0',
                            },
                            {
                                type: 'range',
                                lowerInclusive: '1.81.0',
                                upperExclusive: '1.83.3',
                            },
                        ],
                    },
                    extensionVersion: {
                        type: 'exactMatch',
                        values: ['1.19.0', '1.20.0'],
                    },
                    additionalCriteria: [
                        { type: 'OS', values: ['LINUX', 'MAC'] },
                        { type: 'ComputeEnv', values: ['local', 'ec2'] },
                        { type: 'AuthType', values: ['builderId', 'identityCenter'] },
                        { type: 'AuthRegion', values: ['us-east-1', 'us-west-2'] },
                        { type: 'AuthState', values: ['connected'] },
                        { type: 'AuthScopes', values: ['codewhisperer:completions', 'codewhisperer:analysis'] },
                        { type: 'ActiveExtensions', values: ['ext1', 'ext2'] },
                    ],
                })
            ),
            true
        )
    })

    it('should NOT display notification for invalid combined criteria', function () {
        assert.equal(
            ruleEngine.shouldDisplayNotification(
                buildNotification({
                    ideVersion: {
                        type: 'or',
                        clauses: [
                            {
                                type: 'range',
                                lowerInclusive: '1.70.0',
                                upperExclusive: '1.81.0',
                            },
                            {
                                type: 'range',
                                lowerInclusive: '1.80.0',
                                upperExclusive: '1.83.3',
                            },
                        ],
                    },
                    extensionVersion: {
                        type: 'exactMatch',
                        values: ['1.19.0', '1.20.0'],
                    },
                    additionalCriteria: [
                        { type: 'OS', values: ['LINUX', 'MAC'] },
                        { type: 'AuthType', values: ['builderId', 'identityCenter'] },
                        { type: 'AuthRegion', values: ['us-east-1', 'us-west-2'] },
                        { type: 'AuthState', values: ['connected'] },
                        { type: 'AuthScopes', values: ['codewhisperer:completions', 'codewhisperer:analysis'] },
                        { type: 'ActiveExtensions', values: ['ext1', 'ext2'] },

                        { type: 'ComputeEnv', values: ['ec2'] }, // no 'local'
                    ],
                })
            ),
            false
        )
    })
})

describe('Notifications getRuleContext()', function () {
    it('should return the correct rule context', async function () {
        const context = globals.context
        context.extension.packageJSON.version = '0.0.1'
        const authEnabledConnections = (
            [
                {
                    type: 'iam',
                },
                {
                    type: 'sso',
                    scopes: amazonQScopes,
                    startUrl: builderIdStartUrl,
                },
                {
                    type: 'sso',
                    scopes: scopesCodeCatalyst,
                    startUrl: builderIdStartUrl,
                },
                {
                    type: 'sso',
                    scopes: amazonQScopes,
                    startUrl: 'something',
                },
                {
                    type: 'unknown',
                },
            ] as Connection[]
        )
            .map((c) => getAuthFormIdsFromConnection(c))
            .join(',')

        const ruleContext = await getRuleContext(context, {
            authEnabledConnections,
            authScopes: amazonQScopes.join(','),
            authStatus: 'connected',
            awsRegion: 'us-east-1',
        })
        assert.deepStrictEqual(ruleContext, {
            ideVersion: vscode.version,
            extensionVersion: '0.0.1',
            os: getOperatingSystem(),
            computeEnv: 'test',
            authTypes: ['credentials', 'builderId', 'identityCenter', 'unknown'],
            authRegions: ['us-east-1'],
            authStates: ['connected'],
            authScopes: amazonQScopes,
            activeExtensions: vscode.extensions.all.filter((e) => e.isActive).map((e) => e.id),
        })
    })
})
