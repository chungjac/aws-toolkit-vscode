/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import globals from '../../../shared/extensionGlobals'
import { VueWebview } from '../../../webviews/main'
import { Region } from '../../../shared/regions/endpoints'
import { getTelemetryReasonDesc, ToolkitError } from '../../../shared/errors'
import { CancellationError } from '../../../shared/utilities/timeoutUtils'
import { trustedDomainCancellation } from '../../../auth/sso/model'
import { handleWebviewError } from '../../../webviews/server'
import { InvalidGrantException } from '@aws-sdk/client-sso-oidc'
import {
    AwsConnection,
    Connection,
    hasScopes,
    scopesCodeCatalyst,
    scopesCodeWhispererChat,
    scopesSsoAccountAccess,
    SsoConnection,
    TelemetryMetadata,
} from '../../../auth/connection'
import { Auth } from '../../../auth/auth'
import { StaticProfile, StaticProfileKeyErrorMessage } from '../../../auth/credentials/types'
import { telemetry } from '../../../shared/telemetry/telemetry'
import { AuthAddConnection } from '../../../shared/telemetry/telemetry'
import { AuthSources } from '../util'
import { AuthEnabledFeatures, AuthError, AuthFlowState, AuthUiClick, userCancelled } from './types'
import { DevSettings } from '../../../shared/settings'
import { AuthSSOServer } from '../../../auth/sso/server'
import { getLogger } from '../../../shared/logger/logger'
import { isValidUrl } from '../../../shared/utilities/uriUtils'
import { RegionProfile } from '../../../codewhisperer/models/model'
import { ProfileSwitchIntent } from '../../../codewhisperer/region/regionProfileManager'

export abstract class CommonAuthWebview extends VueWebview {
    private readonly className = 'CommonAuthWebview'
    private metricMetadata: TelemetryMetadata = {}

    // authSource should be set by whatever triggers the auth page flow.
    // It will be reported in telemetry.
    static #authSource: string = AuthSources.vscodeComponent

    public static get authSource() {
        return CommonAuthWebview.#authSource
    }

    public static set authSource(source: string) {
        CommonAuthWebview.#authSource = source
    }

    public get authSource() {
        return CommonAuthWebview.#authSource
    }

    public set authSource(source: string) {
        CommonAuthWebview.#authSource = source
    }

    public getRegions(): Region[] {
        return globals.regionProvider.getRegions().reverse()
    }

    /**
     * Called when the UI load process is completed, regardless of success or failure
     *
     * @param errorMessage IF an error is caught on the frontend, this is the message. It will result in a failure metric.
     *                     Otherwise we assume success.
     */
    public setUiReady(state: 'login' | 'reauth' | 'selectProfile', errorMessage?: string) {
        if (errorMessage) {
            this.setLoadFailure(state, errorMessage)
        } else {
            this.setDidLoad(state)
        }
    }

    /**
     * This wraps the execution of the given setupFunc() and handles common errors from the SSO setup process.
     *
     * @param methodName A value that will help identify which high level function called this method.
     * @param setupFunc The function which will be executed in a try/catch so that we can handle common errors.
     * @param postMetrics Whether to emit telemetry.
     * @returns
     */
    async ssoSetup(methodName: string, setupFunc: () => Promise<any>, postMetrics: boolean = true) {
        const runSetup = async () => {
            try {
                await setupFunc()
                return
            } catch (e) {
                getLogger().error('ssoSetup encountered an error: %s', e)

                if (e instanceof ToolkitError && e.code === 'NotOnboarded') {
                    /**
                     * Connection is fine, they just skipped onboarding so not an actual error.
                     *
                     * The error comes from user cancelling prompt by {@link CodeCatalystAuthenticationProvider.promptOnboarding()}
                     */
                    return
                }

                if (
                    CancellationError.isUserCancelled(e) ||
                    (e instanceof ToolkitError && (CancellationError.isUserCancelled(e.cause) || e.cancelled === true))
                ) {
                    return { id: userCancelled, text: 'Setup cancelled.' }
                }

                if (e instanceof ToolkitError && e.cause instanceof InvalidGrantException) {
                    return {
                        id: 'invalidGrantException',
                        text: 'Permissions for this service may not be enabled by your SSO Admin, or the selected region may not be supported.',
                    }
                }

                if (
                    e instanceof ToolkitError &&
                    (e.code === trustedDomainCancellation || e.cause?.name === trustedDomainCancellation)
                ) {
                    return {
                        id: 'trustedDomainCancellation',
                        text: `Must 'Open' or 'Configure Trusted Domains', unless you cancelled.`,
                    }
                }

                const invalidRequestException = 'InvalidRequestException'
                if (
                    (e instanceof Error && e.name === invalidRequestException) ||
                    (e instanceof ToolkitError && e.cause?.name === invalidRequestException)
                ) {
                    return { id: 'badStartUrl', text: `Connection failed. Please verify your start URL.` }
                }

                // If SSO setup fails we want to be able to show the user an error in the UI, due to this we cannot
                // throw an error here. So instead this will additionally show an error message that provides more
                // detailed information.
                handleWebviewError(e, this.id, methodName)

                return { id: 'defaultFailure', text: 'Failed to setup.' }
            }
        }

        // Add context to our telemetry by adding the methodName argument to the function stack
        const result = await telemetry.function_call.run(
            async () => {
                return runSetup()
            },
            { emit: false, functionId: { name: methodName, class: this.className } }
        )

        if (postMetrics) {
            this.storeMetricMetadata(this.getResultForMetrics(result))
            this.emitAuthMetric()
        }
        this.authSource = AuthSources.vscodeComponent

        return result
    }

    /** Allows the frontend to subscribe to events emitted by the backend regarding the ACTIVE auth connection changing in some way. */
    abstract onActiveConnectionModified: vscode.EventEmitter<void>

    abstract startBuilderIdSetup(app: string): Promise<AuthError | undefined>

    abstract startEnterpriseSetup(startUrl: string, region: string, app: string): Promise<AuthError | undefined>

    async getAuthenticatedCredentialsError(data: StaticProfile): Promise<StaticProfileKeyErrorMessage | undefined> {
        return Auth.instance.authenticateData(data)
    }

    abstract startIamCredentialSetup(
        profileName: string,
        accessKey: string,
        secretKey: string
    ): Promise<AuthError | undefined>

    async showResourceExplorer(): Promise<void> {
        await vscode.commands.executeCommand('aws.explorer.focus')
    }

    abstract fetchConnections(): Promise<AwsConnection[] | undefined>

    async errorNotification(e: AuthError) {
        void vscode.window.showInformationMessage(`${e.text}`)
    }

    abstract quitLoginScreen(): Promise<void>

    /**
     * NOTE: If we eventually need to be able to specify the connection to reauth, it should
     * be an arg in this function
     */
    abstract reauthenticateConnection(): Promise<void>
    abstract getReauthError(): Promise<AuthError | undefined>

    abstract getActiveConnection(): Promise<Connection | undefined>

    /** Refreshes the current state of the auth flow, determining what you see in the UI */
    abstract refreshAuthState(): Promise<void>
    /** Use {@link refreshAuthState} first to ensure this returns the latest state */
    abstract getAuthState(): Promise<AuthFlowState>

    abstract signout(): Promise<void>

    /** List current connections known by the extension for the purpose of preventing duplicates. */
    abstract listSsoConnections(): Promise<SsoConnection[]>

    abstract listRegionProfiles(): Promise<RegionProfile[] | string>

    abstract selectRegionProfile(profile: RegionProfile, source: ProfileSwitchIntent): Promise<void>

    /**
     * Emit stored metric metadata. Does not reset the stored metric metadata, because it
     * may be used for additional emits (e.g. user cancels multiple times, user cancels then logs in)
     */
    emitAuthMetric() {
        // We shouldn't report startUrl or region if we aren't reporting IdC
        if (this.metricMetadata.credentialSourceId !== 'iamIdentityCenter') {
            delete this.metricMetadata.awsRegion
            delete this.metricMetadata.credentialStartUrl
        }
        telemetry.auth_addConnection.emit({
            ...this.metricMetadata,
            source: this.authSource,
        } as AuthAddConnection)
    }

    /**
     * Incrementally store auth metric data during vue, backend sign in logic,
     * and cancellation flows.
     */
    storeMetricMetadata(data: TelemetryMetadata) {
        this.metricMetadata = { ...this.metricMetadata, ...data }
    }

    /**
     * Reset metadata stored by the auth form.
     */
    resetStoredMetricMetadata() {
        this.metricMetadata = {}
    }

    /**
     * Determines the status of the metric to report.
     */
    getResultForMetrics(error?: AuthError) {
        const metadata: Partial<TelemetryMetadata> = {}
        if (error) {
            if (error.id === userCancelled) {
                metadata.result = 'Cancelled'
            } else {
                metadata.result = 'Failed'
                metadata.reason = error.id
                metadata.reasonDesc = getTelemetryReasonDesc(error.text)
            }
        } else {
            metadata.result = 'Succeeded'
        }

        return metadata
    }

    /**
     * The metric when certain elements in the webview are clicked.
     */
    emitUiClick(id: AuthUiClick) {
        telemetry.ui_click.emit({
            elementId: id,
        })
    }

    /**
     * Return a comma-delimited list of features for which the connection has access to.
     */
    getAuthEnabledFeatures(conn: SsoConnection | AwsConnection) {
        const authEnabledFeatures: AuthEnabledFeatures[] = []
        if (hasScopes(conn.scopes!, scopesCodeWhispererChat)) {
            authEnabledFeatures.push('codewhisperer')
        }
        if (hasScopes(conn.scopes!, scopesCodeCatalyst)) {
            authEnabledFeatures.push('codecatalyst')
        }
        if (hasScopes(conn.scopes!, scopesSsoAccountAccess)) {
            authEnabledFeatures.push('awsExplorer')
        }

        return authEnabledFeatures.join(',')
    }

    getDefaultSsoProfile(): { startUrl: string; region: string } {
        const devSettings = DevSettings.instance.get('autofillStartUrl', '')
        if (devSettings) {
            return { startUrl: devSettings, region: 'us-east-1' }
        }

        return globals.globalState.tryGet('recentSso', Object, { startUrl: '', region: 'us-east-1' })
    }

    cancelAuthFlow() {
        AuthSSOServer.lastInstance?.cancelCurrentFlow()
    }

    validateUrl(url: string) {
        return isValidUrl(url)
    }
}
