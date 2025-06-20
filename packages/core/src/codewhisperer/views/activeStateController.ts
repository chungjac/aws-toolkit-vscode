/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import { LineSelection, LinesChangeEvent } from '../tracker/lineTracker'
import { isTextEditor } from '../../shared/utilities/editorUtilities'
import { subscribeOnce } from '../../shared/utilities/vsCodeUtils'
import { Container } from '../service/serviceContainer'
import { cancellableDebounce } from '../../shared/utilities/functionUtils'

export class ActiveStateController implements vscode.Disposable {
    private readonly _disposable: vscode.Disposable
    private _editor: vscode.TextEditor | undefined

    private readonly cwLineHintDecoration: vscode.TextEditorDecorationType =
        vscode.window.createTextEditorDecorationType({
            after: {
                margin: '0 0 0 3em',
                contentText: 'Amazon Q is generating...',
                textDecoration: 'none',
                fontWeight: 'normal',
                fontStyle: 'normal',
                color: 'var(--vscode-editorCodeLens-foreground)',
            },
            rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
            isWholeLine: true,
        })

    constructor(private readonly container: Container) {
        this._disposable = vscode.Disposable.from(
            this.container.lineTracker.onDidChangeActiveLines(async (e) => {
                await this.onActiveLinesChanged(e)
            }),
            subscribeOnce(this.container.lineTracker.onReady)(async (_) => {
                await this.onReady()
            }),
            this.container.auth.auth.onDidChangeConnectionState(async (e) => {
                if (e.state !== 'authenticating') {
                    await this._refresh(vscode.window.activeTextEditor)
                }
            }),
            this.container.auth.secondaryAuth.onDidChangeActiveConnection(async () => {
                await this._refresh(vscode.window.activeTextEditor)
            })
        )
    }

    dispose() {
        this._disposable.dispose()
    }

    private _isReady: boolean = false

    private async onReady(): Promise<void> {
        this._isReady = true
        await this._refresh(vscode.window.activeTextEditor)
    }

    private async onActiveLinesChanged(e: LinesChangeEvent) {
        if (!this._isReady) {
            return
        }

        await this.refreshDebounced.promise(e.editor)
    }

    clear(editor: vscode.TextEditor | undefined) {
        if (this._editor && this._editor !== editor) {
            this._editor.setDecorations(this.cwLineHintDecoration, [])
        }

        editor?.setDecorations(this.cwLineHintDecoration, [])
    }

    readonly refreshDebounced = cancellableDebounce(async (editor: vscode.TextEditor | undefined) => {
        await this._refresh(editor)
    }, 1000)

    private async _refresh(editor: vscode.TextEditor | undefined, shouldDisplay?: boolean) {
        if (!editor && !this._editor) {
            return
        }

        const selections = this.container.lineTracker.selections
        if (!editor || !selections || !isTextEditor(editor)) {
            this.clear(this._editor)
            return
        }

        if (this._editor !== editor) {
            // Clear any annotations on the previously active editor
            this.clear(this._editor)
            this._editor = editor
        }

        // Make sure the editor hasn't died since the await above and that we are still on the same line(s)
        if (!editor.document || !this.container.lineTracker.includes(selections)) {
            return
        }

        if (!this.container.auth.isConnectionValid()) {
            this.clear(this._editor)
            return
        }

        if (shouldDisplay !== undefined) {
            await this.updateDecorations(editor, selections, shouldDisplay)
        } else {
            await this.updateDecorations(editor, selections, true)
        }
    }

    async updateDecorations(editor: vscode.TextEditor, lines: LineSelection[], shouldDisplay: boolean) {
        const range = editor.document.validateRange(
            new vscode.Range(lines[0].active, lines[0].active, lines[0].active, lines[0].active)
        )

        if (shouldDisplay) {
            editor.setDecorations(this.cwLineHintDecoration, [range])
        } else {
            editor.setDecorations(this.cwLineHintDecoration, [])
        }
    }
}
