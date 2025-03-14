/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'assert'
import vscode from 'vscode'
import { qTestingFramework } from './framework/framework'
import sinon from 'sinon'
import { Messenger } from './framework/messenger'
import { FollowUpTypes } from 'aws-core-vscode/amazonq'
import { registerAuthHook, using, TestFolder, closeAllEditors, getTestWorkspaceFolder } from 'aws-core-vscode/test'
import { loginToIdC } from './utils/setup'
import { waitUntil, workspaceUtils, isWin } from 'aws-core-vscode/shared'
import * as path from 'path'

describe('Amazon Q Test Generation', function () {
    let framework: qTestingFramework
    let tab: Messenger

    const testFiles = [
        {
            language: 'python',
            filePath: 'testGenFolder/src/main/math.py',
            testFilePath: 'testGenFolder/src/test/test_math.py',
        },
        {
            language: 'java',
            filePath: 'testGenFolder/src/main/Math.java',
            testFilePath: 'testGenFolder/src/test/MathTest.java',
        },
    ]

    const unsupportedLanguages = [
        // move these over to testFiles once these languages are supported
        // must be atleast one unsupported language here for testing
        {
            language: 'typescript',
            filePath: 'testGenFolder/src/main/math.ts',
        },
        {
            language: 'javascript',
            filePath: 'testGenFolder/src/main/math.js',
        },
    ]

    // handles opening the file since /test must be called on an active file
    async function setupTestDocument(filePath: string, language: string) {
        const document = await waitUntil(async () => {
            const doc = await workspaceUtils.openTextDocument(filePath)
            return doc
        }, {})

        if (!document) {
            assert.fail(`Failed to open ${language} file`)
        }

        await waitUntil(async () => {
            await vscode.window.showTextDocument(document, { preview: false })
        }, {})

        const activeEditor = vscode.window.activeTextEditor
        if (!activeEditor || activeEditor.document.uri.fsPath !== document.uri.fsPath) {
            assert.fail(`Failed to make ${language} file active`)
        }
    }

    async function waitForChatItems(index: number) {
        await tab.waitForEvent(() => tab.getChatItems().length > index, {
            waitTimeoutInMs: 5000,
            waitIntervalInMs: 1000,
        })
    }

    // updates test file with given content
    // not cleaning up test file may possibly cause bloat in CI since testFixtures does not get reset
    async function updateTestFile(testFilePath: string, content: string) {
        const workspaceFolder = getTestWorkspaceFolder()
        const absoluteTestFilePath = path.join(workspaceFolder, testFilePath)
        const testFileUri = vscode.Uri.file(absoluteTestFilePath)
        await vscode.workspace.fs.writeFile(testFileUri, Buffer.from(content, 'utf-8'))
    }

    before(async function () {
        await using(registerAuthHook('amazonq-test-account'), async () => {
            await loginToIdC()
        })
    })

    beforeEach(async () => {
        registerAuthHook('amazonq-test-account')
        framework = new qTestingFramework('testgen', true, [])
        tab = framework.createTab()
    })

    afterEach(async () => {
        // Close all editors to prevent conflicts with subsequent tests trying to open the same file
        await closeAllEditors()
        framework.removeTab(tab.tabID)
        framework.dispose()
        sinon.restore()
    })

    describe('Quick action availability', () => {
        it('Shows /test when test generation is enabled', async () => {
            const command = tab.findCommand('/test')
            if (!command.length) {
                assert.fail('Could not find command')
            }
            if (command.length > 1) {
                assert.fail('Found too many commands with the name /test')
            }
        })

        it('Does NOT show /test when test generation is NOT enabled', () => {
            // The beforeEach registers a framework which accepts requests. If we don't dispose before building a new one we have duplicate messages
            framework.dispose()
            framework = new qTestingFramework('testgen', false, [])
            const tab = framework.createTab()
            const command = tab.findCommand('/test')
            if (command.length > 0) {
                assert.fail('Found command when it should not have been found')
            }
        })
    })

    describe('/test entry', () => {
        describe('Unsupported language file', () => {
            const { language, filePath } = unsupportedLanguages[0]

            beforeEach(async () => {
                await setupTestDocument(filePath, language)
            })

            it(`/test for unsupported language redirects to chat`, async () => {
                tab.addChatMessage({ command: '/test' })
                await tab.waitForChatFinishesLoading()

                await waitForChatItems(3)
                const unsupportedLanguageMessage = tab.getChatItems()[3]

                assert.deepStrictEqual(unsupportedLanguageMessage.type, 'answer')
                assert.deepStrictEqual(
                    unsupportedLanguageMessage.body,
                    `<span style="color: #EE9D28;">&#9888;<b>I'm sorry, but /test only supports Python and Java</b><br></span> While ${language.charAt(0).toUpperCase() + language.slice(1)} is not supported, I will generate a suggestion below.`
                )
            })
        })

        describe('External file out of project', async () => {
            let testFolder: TestFolder
            let fileName: string

            beforeEach(async () => {
                testFolder = await TestFolder.create()
                fileName = 'math.py'
                const filePath = await testFolder.write(fileName, 'def add(a, b): return a + b')

                const document = await vscode.workspace.openTextDocument(filePath)
                await vscode.window.showTextDocument(document, { preview: false })
            })

            it('/test for external file redirects to chat', async () => {
                tab.addChatMessage({ command: '/test' })
                await tab.waitForChatFinishesLoading()

                await waitForChatItems(3)
                const externalFileMessage = tab.getChatItems()[3]

                assert.deepStrictEqual(externalFileMessage.type, 'answer')
                assert.deepStrictEqual(
                    externalFileMessage.body,
                    `<span style="color: #EE9D28;">&#9888;<b>I can't generate tests for ${fileName}</b> because the file is outside of workspace scope.<br></span> I can still provide examples, instructions and code suggestions.`
                )
            })
        })

        describe('Build and execute flow', () => {
            const language = 'java'
            const filePath = 'testGenFolder/gradle-test-project/app/src/main/java/org/example/App.java'
            const testFilePath = 'testGenFolder/gradle-test-project/app/src/test/java/org/example/AppTest.java'
            const buildCommand = isWin()
                ? 'cd \\testGenFolder\\gradle-test-project && gradlew.bat build'
                : 'cd /testGenFolder/gradle-test-project && ./gradlew build'
            const happyTestFileContents = `package org.example;
import org.junit.Test;
import static org.junit.Assert.*;

public class AppTest {
    @Test public void appHasAGreeting() {
        App classUnderTest = new App();
        assertNotNull("app should have a greeting", classUnderTest.getGreeting());
    }
}`
            // const sadTestFileContents = `package org.example;
            //     import org.junit.Test;
            //     import static org.junit.Assert.*;

            //     public class AppTest {
            //         @Test public void appHasAGreeting() {
            //             App classUnderTest = new App();
            //             assertNotNull("app should have a greeting", classUnderTest.getGreeting());
            //         }
            //         words here cause an error so delete this
            //     }`

            beforeEach(async () => {
                await waitUntil(async () => await setupTestDocument(filePath, language), {})

                tab.addChatMessage({ command: '/test' })
                await tab.waitForChatFinishesLoading()

                await tab.waitForButtons([FollowUpTypes.ViewDiff])
                tab.clickButton(FollowUpTypes.ViewDiff)
                await tab.waitForChatFinishesLoading()

                await tab.waitForButtons([FollowUpTypes.AcceptCode, FollowUpTypes.RejectCode])
                tab.clickButton(FollowUpTypes.AcceptCode)
                await tab.waitForChatFinishesLoading()

                await tab.waitForButtons([
                    FollowUpTypes.BuildAndExecute,
                    FollowUpTypes.ModifyCommands,
                    FollowUpTypes.SkipBuildAndFinish,
                ])
                tab.clickButton(FollowUpTypes.ModifyCommands)
                await tab.waitForChatFinishesLoading()
            })

            afterEach(async () => {
                // this e2e test generates unit tests, so we want to replace original test file contents
                await waitUntil(async () => {
                    await updateTestFile(testFilePath, happyTestFileContents)
                }, {})
            })

            it(`Build and execute successful after first iteration`, async () => {
                // replace with happy code, so the build is guaranteed to be sucessful
                await waitUntil(async () => {
                    await updateTestFile(testFilePath, happyTestFileContents)
                }, {})

                tab.addChatMessage({ prompt: buildCommand })
                await tab.waitForChatFinishesLoading()

                await waitForChatItems(13)
                const completeMessage = tab.getChatItems()[13]

                assert.deepStrictEqual(completeMessage?.type, 'answer')
                assert.deepStrictEqual(completeMessage?.body, 'Unit test generation workflow is complete.')
            })

            // it(`Build and execute successful after second iteration`, async () => {
            //     // replace with sad code
            //     // enter correct build command
            //     // go through process again and then replace with happy code
            //     // check that chatitems has correct item
            // })
        })

        for (const { language, filePath, testFilePath } of testFiles) {
            describe(`/test on ${language} file`, () => {
                beforeEach(async () => {
                    await waitUntil(async () => await setupTestDocument(filePath, language), {})

                    tab.addChatMessage({ command: '/test' })
                    await tab.waitForChatFinishesLoading()

                    await tab.waitForButtons([FollowUpTypes.ViewDiff])
                    tab.clickButton(FollowUpTypes.ViewDiff)
                    await tab.waitForChatFinishesLoading()
                })

                describe('View diff of test file', async () => {
                    it('Clicks on view diff', async () => {
                        const chatItems = tab.getChatItems()
                        const viewDiffMessage = chatItems[5]

                        assert.deepStrictEqual(viewDiffMessage.type, 'answer')
                        assert.deepStrictEqual(
                            viewDiffMessage.body,
                            'Please see the unit tests generated below. Click “View diff” to review the changes in the code editor.'
                        )
                    })
                })

                describe('Accept unit tests', async () => {
                    afterEach(async () => {
                        // this e2e test generates unit tests, so we want to clean them up after this test is done
                        await waitUntil(async () => {
                            await updateTestFile(testFilePath, '')
                        }, {})
                    })

                    it('Clicks on accept', async () => {
                        await tab.waitForButtons([FollowUpTypes.AcceptCode, FollowUpTypes.RejectCode])
                        tab.clickButton(FollowUpTypes.AcceptCode)
                        await tab.waitForChatFinishesLoading()

                        await waitForChatItems(7)
                        const acceptedMessage = tab.getChatItems()[7]

                        assert.deepStrictEqual(acceptedMessage?.type, 'answer-part')
                        assert.deepStrictEqual(acceptedMessage?.followUp?.options?.[0].pillText, 'Accepted')
                    })
                })

                describe('Reject unit tests', async () => {
                    it('Clicks on reject', async () => {
                        await tab.waitForButtons([FollowUpTypes.AcceptCode, FollowUpTypes.RejectCode])
                        tab.clickButton(FollowUpTypes.RejectCode)
                        await tab.waitForChatFinishesLoading()

                        await waitForChatItems(7)
                        const rejectedMessage = tab.getChatItems()[7]

                        assert.deepStrictEqual(rejectedMessage?.type, 'answer-part')
                        assert.deepStrictEqual(rejectedMessage?.followUp?.options?.[0].pillText, 'Rejected')
                    })
                })
            })
        }
    })
})
