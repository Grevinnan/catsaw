#!/usr/bin/env node

import cp from 'child_process';
import _ from 'lodash';

import tkit from 'terminal-kit';
const terminal = tkit.terminal;

import yargs from 'yargs'
import {
    hideBin
} from 'yargs/helpers'

const colorMap = {
    'D': '^B',
    'I': '^g',
    'W': '^y',
    'V': '^w',
    'E': '^r',
    'E': '^R',
};

const levels = ['Verbose', 'Debug', 'Info', 'Warn', 'Error', 'Fatal'];
const levelMap = {
    'V': 0,
    'D': 1,
    'I': 2,
    'W': 3,
    'E': 4,
    'F': 5,
};

function getPID(packageName) {
    let pidProc = cp.spawnSync('adb', ['shell', 'pidof', packageName]);
    let pid = pidProc.stdout.toString().trim();
    if (pid.length === 0) {
        return null;
    }
    return pid;
}

function getCurrentYear() {
    let timeProc = cp.spawnSync('adb', ['shell', 'date', '+%Y']);
    let currentYear = timeProc.stdout.toString().trim();
    if (currentYear.length === 0) {
        return null;
    }
    return currentYear;
}

function getTime() {
    let timeProc = cp.spawnSync('adb', ['shell', 'date', '+%s']);
    let timestamp = timeProc.stdout.toString().trim();
    if (timestamp.length === 0) {
        return null;
    }
    return timestamp;
}

let showStatusLine = true;
let interacting = false;
let paused = false;
let filterPackage = null;
let filterRegexp = null;
let filterLogLevel = null;

// TODO: handle resize
const clearLine = Array(terminal.width).join(' ');
let totalFiltered = 0;

let bufferLines = [];
let tail = '';

function printBuffered() {
    // Don't check the PID on buffered lines
    let lines = bufferLines;
    bufferLines = [];
    printLines(lines, false);
}

function clearCurrentLine() {
    terminal(`\r${clearLine}\r`);
}

function printStatus() {
    if (!showStatusLine) {
        terminal(`\r${clearLine}\r`);
        return;
    }
    const stateColor = paused ? '^R' : '^G';
    const stateChar = paused ? 'P' : 'A';
    const stateField = `^#${stateColor}^k ${stateChar} ^:`;
    const filterdField = `^#^y^k ${totalFiltered} ^:`;
    const bufferedField = `^#^b^k ${bufferLines.length} ^:`;
    let statusText = '';
    statusText += stateField;
    statusText += filterdField;
    statusText += bufferedField;
    if (filterPackage !== null) {
        statusText += `^#^W^k ${filterPackage.packageName} ^:`;
    }
    if (filterRegexp !== null) {
        statusText += `^#^c^k ${filterRegexp.searchterm} ^:`;
    }
    if (filterLogLevel !== null) {
        statusText += `^#^M^k ${levels[filterLogLevel]} ^:`;
    }
    let numCarets = 0;
    for (let i = 0; i < statusText.length - 1; ++i) {
        let c = statusText.charAt(i);
        let n = statusText.charAt(i + 1);
        if (c === '^' && n === '^') {
            // TODO: Safe?
            ++i;
        } else if (c === '^' && n !== '^') {
            numCarets += 1;
        }
    }

    const statusStrLen = statusText.length - 2 * numCarets;
    const spacePrefix = Array(terminal.width - statusStrLen).join(' ');

    terminal.saveCursor();
    terminal(`\r${clearLine}\r${spacePrefix}${statusText}`);
    terminal.restoreCursor();
}

async function selectPackage(searchTerm = null) {
    interacting = true;
    clearCurrentLine();
    if (!searchTerm) {
        terminal('Enter package name search: ');
        searchTerm = await terminal.inputField({}).promise;
        terminal('\n');
    }

    // cmd package list packages -e
    let processes = cp.spawnSync('adb', ['shell', 'cmd', 'package', 'list', 'packages', '-e']);
    let installedPackages = processes.stdout.toString().split(/\n/);
    let regexp = new RegExp(`${searchTerm}`, "i");
    let matches = [];
    for (let l of installedPackages) {
        if (l.match(regexp)) {
            matches.push(l);
        }
    }
    if (matches.length === 0) {
        terminal('No matches found\n');
        interacting = false;
        return;
    }

    let packageName = matches[0].substring('package:'.length);
    if (matches.length > 1) {
        let cursorPos = await terminal.getCursorLocation();
        let selectedPackage = await terminal.singleColumnMenu(matches, {}).promise;
        terminal.moveTo(cursorPos.x, cursorPos.y - matches.length);
        for (let i = 0; i < matches.length + 1; ++i) {
            terminal(`${clearLine}\n`);
        }
        terminal.moveTo(cursorPos.x, cursorPos.y - matches.length);
        packageName = selectedPackage.selectedText.substring('package:'.length);
    }

    const filterPID = getPID(packageName);
    terminal(`Using package name ^g${packageName}^:\n`);
    terminal(`Found PID ^g${filterPID}^:\n`);
    filterPackage = {
        packageName: packageName,
        PID: filterPID,
        timestampPID: new Date(getTime() * 1000),
        searchExpr: new RegExp(_.escapeRegExp(packageName)),
    };
    if (!filterPID) {
        terminal('^rCould not get PID, waiting for start^:\n\n');
    }
    terminal('\n');
    printStatus();
    interacting = false;
}

let textColor = '^w';
terminal.grabInput(true);
// terminal.fullscreen(true);
terminal.on('key', async (key) => {
    // console.log(key);
    if (key === 'CTRL_C' || key === 'CTRL_D') {
        terminal('\n');
        terminal.grabInput(false);
        terminal.fullscreen(false);
        terminal.applicationKeypad(false);
        terminal.hideCursor(false);
        process.exit();
    }
    if (interacting) {
        return;
    }
    if (key === 'l') {
        interacting = true;
        clearCurrentLine();
        let level = await terminal.singleColumnMenu(levels, {}).promise;
        terminal('\n');
        filterLogLevel = level.selectedIndex;
        interacting = false;
        printStatus();
    }
    if (key === 'L') {
        clearCurrentLine();
        terminal('Clearing log level\n');
        filterLogLevel = null;
    }
    if (key === 's') {
        interacting = true;
        clearCurrentLine();
        terminal('Enter search term: ');
        let searchTerm = await terminal.inputField({}).promise;
        terminal('\n');
        filterRegexp = {
            regexp: new RegExp(`(${searchTerm})`, "ig"),
            // Escape the formatting characters
            searchterm: searchTerm.replaceAll(/\^/g, "^^"),
        };
        interacting = false;
        printStatus();
    }
    if (key === 'S') {
        clearCurrentLine();
        terminal('Clearing search term\n');
        filterRegexp = null;
    }
    if (key === 'P') {
        clearCurrentLine();
        terminal('Clearing app-filter\n');
        filterPackage = null;
    }
    if (key === 'p') {
        selectPackage();
    }
    if (key == 'ENTER') {
        clearCurrentLine();
        terminal("\n");
        printStatus();
    }
    if (key == 'u') {
        showStatusLine = !showStatusLine;
        printStatus();
    }
    if (key == ' ') {
        paused = !paused;
        printBuffered();
        // terminal("\n");
    }
});


//y: term.height , x: 1 ,
// echoChar: '*' ,
//*
//default: 'mkdir ""' ,
//cursorPosition: -2 ,
// history: history ,
// autoComplete: true ,
// autoCompleteMenu: true ,
// autoCompleteHint: true ,
// hintStyle: terminal.brightBlack.italic ,
//*/
//maxLength: 3
// let history = [];

function parseThreadtimeTime(day, hour) {
    let t = new Date(0);
    let dayParts = day.split('-').map(x => parseInt(x))
    t.setMonth(dayParts[0] - 1);
    t.setDate(dayParts[1]);
    let hourParts = hour.split(':');
    t.setHours(parseInt(hourParts[0]));
    t.setMinutes(parseInt(hourParts[1]));
    let secondParts = hourParts[2].split('.').map(x => parseInt(x));
    t.setSeconds(secondParts[0], secondParts[1]);
    t.setFullYear(currentDeviceYear);
    return t;
}

function checkActivityManager(line) {
    const packageName = line.parts[5];
    // Refresh the PID if the filtered process is affected
    if (filterPackage && packageName === 'ActivityManager:') {
        if (line.line.match(line.searchExpr)) {
            const day = line.parts[0];
            const hour = line.parts[1];
            let logTime = parseThreadtimeTime(day, hour);
            // Don't check PID if we don't have to!
            if (logTime.getTime() > filterPackage.timestampPID) {
                // console.log('checking PID');
                filterPackage.PID = getPID(filterPackage.packageName);
            }
            // console.timeEnd('PID');
            // terminal(`new PID ${filterPackage.PID}\n`);
        }
    }
}

function printLines(lines, checkAM) {
    let printedLines = 0;
    // Clear the status
    clearCurrentLine();
    for (let l of lines) {
        if (checkAM) {
            checkActivityManager(l);
        }
        const PID = l.parts[2];
        const type = l.parts[4];
        const level = levelMap[type];
        if (filterLogLevel !== null && level < filterLogLevel) {
            continue;
        }
        if (filterPackage && PID !== filterPackage.PID) {
            continue;
        }
        if (type in colorMap) {
            textColor = colorMap[type];
        }
        if (filterRegexp !== null) {
            let replaced = l.line.replaceAll(filterRegexp.regexp, `^#^m$1^#^:${textColor}`);
            // If the length changed we know that we found a match
            if (replaced.length === l.line.length) {
                continue;
            }
            l.line = replaced;
        }
        terminal(`${textColor}${l.line}\n`);
        printedLines += 1;
    }
    // Show some kind of status so that you know when it is active
    if (printedLines == 0) {
        totalFiltered += lines.length;
        // terminal(`\r${spaceLine}\rFiltered ^#^g^k${lines.length}^: lines`);
        // printStatus();
    }
    printStatus();
}

const options = yargs(hideBin(process.argv))
    .scriptName('catsaw')
    .version('v0.0.1')
    .usage('catsaw - adb logcat wrapper')
    .alias('h', 'help')
    .strict(true)
    .option('v', {
        alias: 'verbose',
        type: 'boolean',
        description: 'Verbose output',
        default: false,
    })
    .option('p', {
        alias: 'package',
        type: 'string',
        description: 'Filter on selected package',
    }).argv;

// TODO: Check adb status
const currentDeviceYear = getCurrentYear();

let logcat = cp.spawn('adb', ['logcat', '-v', 'threadtime']);

if (options.package) {
    selectPackage(options.package);
}

logcat.stdout.on('data', function(data) {
    const bufferData = !paused && !interacting;
    if (bufferData && bufferLines.length > 0) {
        printBuffered();
    }
    let logString = tail + data.toString();
    let lastNewline = logString.lastIndexOf("\n");
    const logLines = logString.substring(0, lastNewline).split(/\n/);
    tail = logString.substring(lastNewline + 1);
    let lines = [];
    for (let l of logLines) {
        const lineParts = l.split(/\s+/);
        lines.push({
            parts: lineParts,
            line: l,
        });
    }
    if (interacting || paused) {
        bufferLines.push(...lines);
        if (paused) {
            printStatus();
        }
    } else {
        printLines(lines, true);
    }
});
