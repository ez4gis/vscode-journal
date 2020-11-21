// Copyright (C) 2018  Patrick Maué
//
// This file is part of vscode-journal.
//
// vscode-journal is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// vscode-journal is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with vscode-journal.  If not, see <http://www.gnu.org/licenses/>.
//

'use strict';


import * as vscode from 'vscode';
import * as J from '../.';
import * as Q from 'q';
import * as Path from 'path';
import * as fs from 'fs';
import { isNullOrUndefined } from 'util';

export class Startup {

    /**
     *
     */
    constructor(public context: vscode.ExtensionContext, public config: vscode.WorkspaceConfiguration) {

    }


    
    public initialize(): Q.Promise<J.Util.Ctrl> {
        return Q.Promise<J.Util.Ctrl>((resolve, reject) => {
            try {
                let ctrl = new J.Util.Ctrl(this.config);
                if (ctrl.config.isDevelopmentModeEnabled() == true) {
                    console.log("Development Mode for Journal extension is enabled, Tracing in Console and Output is activated.");
                }

                resolve(ctrl);  
            } catch (error) {
                reject(error);
            }
        });
    }

    public registerLoggingChannel(ctrl: J.Util.Ctrl, context: vscode.ExtensionContext): Q.Promise<J.Util.Ctrl> {
        return Q.Promise<J.Util.Ctrl>((resolve, reject) => {
            try {
                let channel: vscode.OutputChannel =  vscode.window.createOutputChannel("Journal"); 
                context.subscriptions.push(channel); 
                ctrl.logger = new J.Util.Logger(ctrl, channel); 
                ctrl.logger.debug("VSCode Journal is starting"); 

                resolve(ctrl); 
            } catch (error) {
                reject(error); 
            }
       

        }); 
    }


    public registerCommands(ctrl: J.Util.Ctrl, context: vscode.ExtensionContext): Q.Promise<J.Util.Ctrl> {
        return Q.Promise<J.Util.Ctrl>((resolve, reject) => {
            ctrl.logger.trace("Entering registerCommands() in util/startup.ts"); 

            let commands = new J.Extension.JournalCommands(ctrl);

            try {
                context.subscriptions.push(
                    vscode.commands.registerCommand('journal.today', () => {
                        commands.showEntry(0)
                            .catch(error => commands.showError(error))
                            .done();
                    }),
                    vscode.commands.registerCommand('journal.yesterday', () => {
                        commands.showEntry(-1)
                            .catch(error => commands.showError(error))
                            .done();
                    }),
                    vscode.commands.registerCommand('journal.tomorrow', () => {
                        commands.showEntry(1)
                            .catch(error => commands.showError(error))
                            .done();
                    }),
                    vscode.commands.registerCommand('journal.day', () => {
                        commands.processInput()
                            .catch(error => {
                                commands.showError(error); 
                            })
                            .done();
                    }),
                    vscode.commands.registerCommand('journal.note', () => {
                        commands.showNote()
                            .catch(error => commands.showError(error))
                            .done();
                    }),
                    vscode.commands.registerCommand('journal.open', () => {
                        commands.loadJournalWorkspace()
                            .catch(error => commands.showError(error))
                            .done();
                    }), 
                );

                resolve(ctrl);

            } catch (error) {
                reject(error);
            }

        });

    }

}