#!/bin/sh
# Оновлює ?v= у index.html, щоб браузери не змішували старі й нові файли після деплою
V=$(date +%Y%m%d%H%M); sed -i -E "s#(href=\"style.css|src=\"crypto.js|src=\"app.js)(\?v=[0-9]+)?\"#\1?v=$V\"#g" index.html; echo "v=$V"
