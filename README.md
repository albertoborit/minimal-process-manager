# Minimalist Resources Manager for Node

## Description

A simple and lightweight process manager for Node.js applications. This tool allows you to start, manage, and monitor Node.js processes easily. It supports running processes in cluster mode to utilize multiple CPU cores effectively and provides basic memory usage logging to help you keep track of your application's resource consumption.

## Usage

To start a Node.js script using the Minimalist Resources Manager, use the following command:
```
minimal-process-manager start script.js
```

To run a script named example.js in cluster mode, you would use:
```
minimal-process-manager start example.js --cluster
```

To run a script named example.js in reload  mode, you would use:
```
minimal-process-manager start example.js --unlimited
```

To install the Minimalist Resources Manager globally, use:

```
npm install -g minimal-process-manager
```

