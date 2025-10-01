class WedecodeApp {
    constructor() {
        this.currentWorkspaceId = null;
        this.selectedFiles = [];
        this.socket = null;
        this.executionId = null;
        this.isProcessing = false;
        this.fullLogHistory = []; // 存储完整日志历史
        this.processOutputHistory = []; // 存储反编译进程的详细输出
        
        this.initializeElements();
        this.setupEventListeners();
        this.connectWebSocket();
    }

    initializeElements() {
        this.uploadArea = document.getElementById('uploadArea');
        this.multiFileInput = document.getElementById('multiFileInput');
        this.folderInput = document.getElementById('folderInput');
        this.uploadText = document.getElementById('uploadText');
        this.uploadHint = document.getElementById('uploadHint');
        this.uploadBtn = document.getElementById('uploadBtn');
        this.downloadBtn = document.getElementById('downloadBtn');
        this.viewFullLogBtn = document.getElementById('viewFullLogBtn');
        this.status = document.getElementById('status');
        this.logContent = document.getElementById('logContent');
        this.clearLogBtn = document.getElementById('clearLogBtn');
        
        // 配置选项元素
        this.wxidInput = document.getElementById('wxidInput');
        this.skipWxid = document.getElementById('skipWxid');
        this.usePx = document.getElementById('usePx');
        this.unpackOnly = document.getElementById('unpackOnly');
        
        // 模态框元素
        this.logModal = document.getElementById('logModal');
        this.closeModal = document.getElementById('closeModal');
        this.fullLogContent = document.getElementById('fullLogContent');
        this.copyLogBtn = document.getElementById('copyLogBtn');
    }



    setupEventListeners() {
        // 文件上传区域事件
        this.uploadArea.addEventListener('click', () => {
            if (!this.isProcessing) {
                this.showFileSelectionOptions();
            }
        });

        this.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!this.isProcessing) {
                this.uploadArea.classList.add('dragover');
            }
        });

        this.uploadArea.addEventListener('dragleave', () => {
            this.uploadArea.classList.remove('dragover');
        });

        this.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            this.uploadArea.classList.remove('dragover');
            if (!this.isProcessing && e.dataTransfer.files.length > 0) {
                // 传递 DataTransferItems 以支持文件夹拖拽
                this.handleDroppedFiles(e.dataTransfer.files, e.dataTransfer.items);
            }
        });

        // 多文件选择事件
        this.multiFileInput.addEventListener('change', (e) => {
            console.log('多文件选择事件触发，文件数量:', e.target.files ? e.target.files.length : 0);
            
            if (e.target.files && e.target.files.length > 0 && !this.isProcessing) {
                this.handleMultiFileSelect(e.target.files);
            }
        });

        // 按钮事件
        this.uploadBtn.addEventListener('click', () => {
            this.uploadAndDecompile();
        });

        this.downloadBtn.addEventListener('click', () => {
            this.downloadResults();
        });

        this.clearLogBtn.addEventListener('click', () => {
            this.clearLogs();
        });

        // 查看完整日志按钮事件
        this.viewFullLogBtn.addEventListener('click', () => {
            this.showFullLogModal();
        });

        // 模态框关闭事件
        this.closeModal.addEventListener('click', () => {
            this.hideFullLogModal();
        });

        // 复制日志按钮事件
        this.copyLogBtn.addEventListener('click', () => {
            this.copyLogsToClipboard();
        });

        // 点击模态框背景关闭
        this.logModal.addEventListener('click', (e) => {
            if (e.target === this.logModal) {
                this.hideFullLogModal();
            }
        });

        // ESC键关闭模态框
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.logModal.style.display === 'block') {
                this.hideFullLogModal();
            }
        });

        // skipWxid 勾选框事件
        this.skipWxid.addEventListener('change', () => {
            if (this.skipWxid.checked) {
                this.wxidInput.disabled = true;
                this.wxidInput.placeholder = '已选择不使用 WXID';
                this.wxidInput.style.opacity = '0.6';
            } else {
                this.wxidInput.disabled = false;
                this.wxidInput.placeholder = '输入小程序的 WXID (必需)';
                this.wxidInput.style.opacity = '1';
            }
        });



        // 文件夹选择事件
        this.folderInput.addEventListener('change', (e) => {
            console.log('文件夹选择事件触发，文件数量:', e.target.files ? e.target.files.length : 0);
            
            if (e.target.files && e.target.files.length > 0 && !this.isProcessing) {
                this.handleFolderSelect(e.target.files);
            }
        });
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        
        this.socket = new WebSocket(wsUrl);
        
        this.socket.onopen = () => {
            this.addLog('WebSocket 连接已建立', 'success');
            
            // 订阅工作区事件 - 使用当前工作区ID或默认ID
            const workspaceId = this.currentWorkspace?.id || 'default';
            this.socket.send(JSON.stringify({
                type: 'subscribe',
                workspaceId: workspaceId
            }));
            console.log('已发送 subscribe 消息，workspaceId:', workspaceId);
        };
        
        this.socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('收到 WebSocket 消息:', data); // 添加调试日志
                this.handleWebSocketMessage(data);
            } catch (error) {
                console.error('WebSocket 消息解析错误:', error);
            }
        };
        
        this.socket.onclose = () => {
            this.addLog('WebSocket 连接已断开', 'warning');
            // 尝试重连
            setTimeout(() => {
                this.connectWebSocket();
            }, 3000);
        };
        
        this.socket.onerror = (error) => {
            this.addLog('WebSocket 连接错误', 'error');
            console.error('WebSocket error:', error);
        };
    }

    handleWebSocketMessage(data) {
        if (data.type === 'execution' && data.executionId === this.executionId) {
            if (data.event === 'output') {
                // 处理不同类型的输出
                const output = data.data.trim();
                if (output) {
                    // 添加到反编译进程输出历史（用于完整日志显示）
                    this.processOutputHistory.push({
                        timestamp: new Date().toLocaleString(),
                        content: output,
                        type: 'output'
                    });
                    
                    // 根据输出内容判断日志类型
                    let logType = 'info';
                    // 只有明确的错误信息才标记为error，避免误判文件名中包含error的情况
                    if (output.includes('❌') || output.includes('错误:') || output.includes('Error:') || 
                        output.includes('失败') || output.includes('异常') || output.includes('Exception')) {
                        logType = 'error';
                    } else if (output.includes('⚠️') || output.includes('警告:') || output.includes('Warning:')) {
                        logType = 'warning';
                    } else if (output.includes('✅') || output.includes('🎉') || output.includes('成功') || 
                               output.includes('完成') || output.includes('Success') || output.includes('Completed')) {
                        logType = 'success';
                    }
                    
                    this.addLog(output, logType);
                }
            } else if (data.event === 'error') {
                // 添加到反编译进程输出历史
                this.processOutputHistory.push({
                    timestamp: new Date().toLocaleString(),
                    content: data.data,
                    type: 'error'
                });
                
                this.addLog(data.data, 'error');
            } else if (data.event === 'exit') {
                console.log('收到 exit 事件，退出码:', data.code); // 添加调试日志
                
                this.isProcessing = false;
                this.executionId = null;
                
                if (data.code === 0) {
                    this.addLog('🎉 反编译完成！', 'success');
                    this.showStatus('反编译成功完成', 'success');
                    this.downloadBtn.disabled = false;
                } else {
                    this.addLog(`❌ 反编译失败，退出码: ${data.code}`, 'error');
                    this.showStatus('反编译失败', 'error');
                }
                
                this.uploadBtn.disabled = false;
                this.uploadBtn.innerHTML = '<i class="fas fa-play"></i> 开始反编译';
            }
        }
    }



    handleMultiFileSelect(files) {
        console.log('多文件选择开始，文件数量:', files ? files.length : 0);
        
        // 清空之前的状态
        this.clearLogs();
        this.closeFileSelectionModal();
        
        if (!files || files.length === 0) {
            this.addLog('❌ 错误: 未选择任何文件', 'error');
            return;
        }

        // 转换为数组并过滤 .wxapkg 文件
        const fileArray = Array.from(files);
        const wxapkgFiles = fileArray.filter(file => 
            file.name.toLowerCase().endsWith('.wxapkg')
        );

        if (wxapkgFiles.length === 0) {
            this.addLog('❌ 错误: 选择的文件中没有找到 .wxapkg 文件', 'error');
            return;
        }

        // 更新选择的文件（先复制后再清空 input）
        this.selectedFiles = wxapkgFiles;
        // 现在可以安全地清空 input 值，避免影响 FileList
        this.multiFileInput.value = '';
        
        // 启用上传按钮
        this.uploadBtn.disabled = false;
        this.downloadBtn.disabled = true;

        // 显示成功信息
        this.addLog(`✅ 成功选择 ${wxapkgFiles.length} 个 .wxapkg 文件`, 'success');
        wxapkgFiles.forEach((file, index) => {
            this.addLog(`📄 文件 ${index + 1}: ${file.name} (${this.formatFileSize(file.size)})`, 'info');
        });
        
        // 自动填充wxid
        this.autoFillWxid(wxapkgFiles);
        
        console.log('多文件选择完成，有效文件数:', wxapkgFiles.length);
    }

    getDecompileOptions() {
        const options = [];
        
        // 固定设置：清空旧产物为 true，完成后不打开目录
        options.push('--clear');
        
        if (this.usePx.checked) {
            options.push('--px');
        }
        
        if (this.unpackOnly.checked) {
            options.push('--unpack-only');
        }
        
        // 添加 wxid 参数
        const wxid = this.wxidInput.value.trim();
        const skipWxid = this.skipWxid.checked;
        if (!skipWxid && wxid) {
            options.push('--wxid');
            options.push(wxid);
        }
        
        // 使用默认的临时缓存目录，不需要用户指定输出目录
        
        return options;
    }

    checkFileSizes() {
        const maxFileSize = 100 * 1024 * 1024; // 100MB
        const maxTotalSize = 500 * 1024 * 1024; // 500MB
        const maxFileCount = 100;

        let totalSize = 0;
        let fileCount = 0;
        let largeFiles = [];

        // 检查选中的文件
        const filesToCheck = this.selectedFiles && this.selectedFiles.length > 0 
            ? this.selectedFiles 
            : (this.selectedFile ? [this.selectedFile] : []);

        for (const file of filesToCheck) {
            fileCount++;
            totalSize += file.size;

            if (file.size > maxFileSize) {
                largeFiles.push({
                    name: file.name,
                    size: this.formatFileSize(file.size)
                });
            }
        }

        // 检查文件数量
        if (fileCount > maxFileCount) {
            return {
                valid: false,
                message: `文件数量超过限制，最多只能上传 ${maxFileCount} 个文件，当前选择了 ${fileCount} 个文件`
            };
        }

        // 检查单个文件大小
        if (largeFiles.length > 0) {
            const fileList = largeFiles.map(f => `${f.name} (${f.size})`).join(', ');
            return {
                valid: false,
                message: `以下文件超过 100MB 限制: ${fileList}`
            };
        }

        // 检查总大小
        if (totalSize > maxTotalSize) {
            return {
                valid: false,
                message: `文件总大小超过限制，最大允许 500MB，当前总大小: ${this.formatFileSize(totalSize)}`
            };
        }

        return {
            valid: true,
            message: `文件检查通过，共 ${fileCount} 个文件，总大小: ${this.formatFileSize(totalSize)}`
        };
    }

    async uploadAndDecompile() {
        // 检查是否有选择的文件或文件夹
        if (this.selectedFiles && this.selectedFiles.length > 0) {
            // 文件夹模式：有多个文件
        } else if (this.selectedFile) {
            // 单文件模式
        } else {
            this.showStatus('请先选择 wxapkg 文件或包含 wxapkg 文件的文件夹', 'error');
            return;
        }

        // 检查 wxid 配置
        const wxid = this.wxidInput.value.trim();
        const skipWxid = this.skipWxid.checked;
        
        if (!skipWxid && !wxid) {
            this.showStatus('请输入 WXID 或勾选"不使用 WXID"选项', 'error');
            this.addLog('❌ 配置错误: 默认需要提供 WXID，如不需要请勾选"不使用 WXID"选项', 'error');
            return;
        }
        
        // 验证 wxid 格式
        if (!skipWxid && wxid && !this.isWxAppid(wxid)) {
            this.showStatus('WXID 格式不正确', 'error');
            this.addLog('❌ WXID 格式错误: WXID 应为 wx 开头的18位字符串，如 wx1234567890abcdef', 'error');
            return;
        }

        if (this.isProcessing) {
            this.showStatus('正在处理中，请稍候...', 'warning');
            return;
        }

        this.isProcessing = true;
        this.uploadBtn.disabled = true;
        this.downloadBtn.disabled = true;
        this.uploadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
        
        // 清空历史日志
        this.clearLogs();
        
        this.showStatus('正在上传并反编译...', 'processing');
        this.addLog('🚀 开始反编译流程...', 'info');

        try {
            // 检查文件大小
            const sizeCheck = this.checkFileSizes();
            if (!sizeCheck.valid) {
                throw new Error(sizeCheck.message);
            }

            // 创建工作区
            const workspace = await this.createWorkspace();
            this.currentWorkspaceId = workspace.id;
            this.currentWorkspace = workspace;
            this.addLog(`✅ 创建工作区: ${workspace.name}`, 'success');
            
            // 重新订阅新的工作区ID
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({
                    type: 'subscribe',
                    workspaceId: workspace.id
                }));
                console.log('重新订阅工作区:', workspace.id);
            }

            // 获取配置选项
            const options = this.getDecompileOptions();
            this.addLog(`⚙️ 反编译选项: ${options.length > 0 ? options.join(' ') : '默认配置'}`, 'info');

            // 上传并反编译文件
            const formData = new FormData();
            
            if (this.selectedFiles && this.selectedFiles.length > 0) {
                // 文件夹上传模式：上传多个文件
                this.selectedFiles.forEach((file, index) => {
                    formData.append('wxapkg', file);
                });
                this.addLog(`📤 正在上传 ${this.selectedFiles.length} 个文件...`, 'info');
            } else {
                // 单文件上传模式
                formData.append('wxapkg', this.selectedFile);
                this.addLog('📤 正在上传文件...', 'info');
            }
            
            formData.append('options', JSON.stringify(options));

            const response = await fetch(`/api/workspaces/${this.currentWorkspaceId}/decompile`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                if (response.status === 413) {
                    // 处理文件大小超限错误
                    try {
                        const errorData = await response.json();
                        throw new Error(errorData.message || '文件大小超过限制');
                    } catch (parseError) {
                        throw new Error('文件大小超过限制，请减少文件数量或选择较小的文件');
                    }
                } else {
                    throw new Error(`上传失败: ${response.statusText}`);
                }
            }

            const result = await response.json();
            this.addLog('✅ 文件上传成功，开始反编译...', 'success');
            
            if (result.executionId) {
                this.executionId = result.executionId;
                this.addLog('🔄 反编译进程已启动，正在处理...', 'info');
                this.showStatus('正在反编译，请查看日志...', 'processing');
            } else {
                throw new Error('未能启动反编译进程');
            }

        } catch (error) {
            this.isProcessing = false;
            this.addLog(`❌ 错误: ${error.message}`, 'error');
            this.showStatus('上传失败', 'error');
            this.uploadBtn.disabled = false;
            this.uploadBtn.innerHTML = '<i class="fas fa-play"></i> 开始反编译';
        }
    }

    async createWorkspace() {
        const response = await fetch('/api/workspaces', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: `反编译_${new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')}`,
                type: 'miniapp',
                description: '微信小程序反编译工作区'
            })
        });

        if (!response.ok) {
            throw new Error('创建工作区失败');
        }

        return await response.json();
    }

    async downloadResults() {
        if (!this.currentWorkspaceId) {
            this.showStatus('没有可下载的结果', 'error');
            return;
        }

        this.addLog('📦 正在打包下载文件...', 'info');
        this.showStatus('正在准备下载...', 'processing');

        try {
            const response = await fetch(`/api/workspaces/${this.currentWorkspaceId}/download`, {
                method: 'GET'
            });

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error('未找到反编译结果，请先完成反编译');
                }
                throw new Error('下载失败');
            }

            // 从响应头中获取文件名
            let filename = `反编译结果_${new Date().toISOString().slice(0, 10)}.zip`; // 默认文件名
            const contentDisposition = response.headers.get('Content-Disposition');
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                if (filenameMatch && filenameMatch[1]) {
                    // 移除引号并解码
                    filename = decodeURIComponent(filenameMatch[1].replace(/['"]/g, ''));
                }
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            this.addLog(`✅ 下载完成！文件名: ${filename}`, 'success');
            this.showStatus('下载完成', 'success');

        } catch (error) {
            this.addLog(`❌ 下载失败: ${error.message}`, 'error');
            this.showStatus('下载失败', 'error');
        }
    }

    addLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const fullTimestamp = new Date().toLocaleString();
        const logLine = document.createElement('div');
        logLine.className = `log-line ${type}`;
        logLine.textContent = `[${timestamp}] ${message}`;
        
        // 添加到显示区域
        this.logContent.appendChild(logLine);
        this.logContent.scrollTop = this.logContent.scrollHeight;
        
        // 添加到完整日志历史
        this.fullLogHistory.push({
            timestamp: fullTimestamp,
            message: message,
            type: type
        });
        
        // 启用查看完整日志按钮
        if (this.viewFullLogBtn) {
            this.viewFullLogBtn.disabled = false;
        }
    }

    clearLogs() {
        this.logContent.innerHTML = '';
        this.fullLogHistory = [];
        this.processOutputHistory = []; // 同时清空反编译进程输出历史
        
        // 禁用查看完整日志按钮
        if (this.viewFullLogBtn) {
            this.viewFullLogBtn.disabled = true;
        }
    }

    showStatus(message, type) {
        this.status.textContent = message;
        this.status.className = `status ${type}`;
        this.status.classList.remove('hidden');

        // 清除之前的 spinner
        const existingSpinner = this.status.querySelector('.spinner');
        if (existingSpinner) {
            existingSpinner.remove();
        }

        if (type === 'processing') {
            const spinner = document.createElement('span');
            spinner.className = 'spinner';
            spinner.style.marginRight = '10px';
            this.status.insertBefore(spinner, this.status.firstChild);
        }
    }

    showFullLogModal() {
        // 生成完整日志内容 - 显示反编译进程的详细输出
        let logText = '';
        if (this.processOutputHistory.length === 0) {
            logText = '暂无反编译进程日志内容\n\n如果您看到此消息，说明反编译进程尚未开始或没有产生输出。';
        } else {
            logText = this.processOutputHistory.map(log => {
                const typePrefix = log.type === 'error' ? '❌ [错误] ' : '';
                return `${typePrefix}${log.content}`;
            }).join('\n');
        }
        
        this.fullLogContent.textContent = logText;
        this.logModal.style.display = 'block';
        
        // 滚动到底部
        setTimeout(() => {
            this.fullLogContent.scrollTop = this.fullLogContent.scrollHeight;
        }, 100);
    }

    hideFullLogModal() {
        this.logModal.style.display = 'none';
    }

    async copyLogsToClipboard() {
        try {
            // 获取当前显示的日志内容
            const logText = this.fullLogContent.textContent;
            
            // 使用现代的 Clipboard API
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(logText);
            } else {
                // 降级方案：使用传统的 document.execCommand
                const textArea = document.createElement('textarea');
                textArea.value = logText;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }
            
            // 显示成功提示
            this.showCopySuccess();
        } catch (err) {
            console.error('复制失败:', err);
            this.showCopyError();
        }
    }

    showCopySuccess() {
        const originalText = this.copyLogBtn.innerHTML;
        this.copyLogBtn.innerHTML = '<i class="fas fa-check"></i> 已复制';
        this.copyLogBtn.style.background = '#28a745';
        
        setTimeout(() => {
            this.copyLogBtn.innerHTML = originalText;
            this.copyLogBtn.style.background = '';
        }, 2000);
    }

    showCopyError() {
        const originalText = this.copyLogBtn.innerHTML;
        this.copyLogBtn.innerHTML = '<i class="fas fa-times"></i> 复制失败';
        this.copyLogBtn.style.background = '#dc3545';
        
        setTimeout(() => {
            this.copyLogBtn.innerHTML = originalText;
            this.copyLogBtn.style.background = '';
        }, 2000);
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 判断是否是wx的appid
     */
    isWxAppid(str) {
        const reg = /^wx[0-9a-f]{16}$/i;
        str = str.trim();
        return str.length === 18 && reg.test(str);
    }

    /**
     * 跨平台路径分割函数
     */
    splitPath(filePath) {
        if (!filePath) return [];
        
        // 处理不同操作系统的路径分隔符
        // Windows: \ 或 /
        // macOS/Linux: /
        // 同时处理混合路径分隔符的情况
        return filePath.split(/[/\\]+/).filter(part => part.length > 0);
    }

    /**
     * 从路径中解析wxid，从尾部往左查找最新的wxid
     */
    parseWxidFromPath(filePath) {
        if (!filePath) return null;
        
        // 使用跨平台路径分割
        const pathParts = this.splitPath(filePath);
        
        // 从尾部往左遍历，查找符合wxid格式的字符串
        for (let i = pathParts.length - 1; i >= 0; i--) {
            const part = pathParts[i];
            
            // 直接检查是否为wxid
            if (this.isWxAppid(part)) {
                return part;
            }
            
            // 检查是否包含wxid（处理类似 "wx1234567890abcdef_1.0.0" 的情况）
            const wxidMatch = part.match(/wx[0-9a-f]{16}/i);
            if (wxidMatch && this.isWxAppid(wxidMatch[0])) {
                return wxidMatch[0];
            }
        }
        
        // 如果路径中没有找到，尝试在整个字符串中搜索
        const fullPathMatch = filePath.match(/wx[0-9a-f]{16}/i);
        if (fullPathMatch && this.isWxAppid(fullPathMatch[0])) {
            return fullPathMatch[0];
        }
        
        return null;
    }

    /**
     * 自动填充wxid到输入框
     */
    autoFillWxid(files) {
        if (!files || files.length === 0) return;
        
        // 每次都先清空wxid输入框
        if (this.wxidInput) {
            this.wxidInput.value = '';
        }
        
        // 尝试从文件中解析wxid
        let wxid = null;
        let pathSource = '';
        
        for (const file of files) {
            // 收集所有可能的路径信息
            const pathCandidates = [];
            
            if (file.webkitRelativePath) {
                pathCandidates.push(file.webkitRelativePath);
            }
            if (file.relativePath) {
                pathCandidates.push(file.relativePath);
            }
            if (file.path) {
                pathCandidates.push(file.path);
            }
            if (file.name) {
                pathCandidates.push(file.name);
            }
            
            // 从所有路径候选中搜索 wxid
            for (const candidate of pathCandidates) {
                const extractedWxid = this.parseWxidFromPath(candidate);
                if (extractedWxid) {
                    wxid = extractedWxid;
                    pathSource = '文件夹路径';
                    break;
                }
            }
            
            if (wxid) break; // 找到第一个有效的wxid就停止
        }
        
        if (wxid && this.wxidInput) {
            this.wxidInput.value = wxid;
            this.addLog(`🔍 自动检测到 wxid: ${wxid} (来源: ${pathSource})`, 'info');
        } else {
            // 检查是否为标准的微信小程序文件名
            const hasStandardFiles = files.some(file => 
                /^(__APP__|__SUBPACKAGES__|__WORKERS__|__GAME__)\.wxapkg$/i.test(file.name)
            );
            
            if (hasStandardFiles) {
                this.addLog(`ℹ️ 未在文件夹路径中找到有效的 wxid`, 'info');
            }
        }
    }

    /**
     * 显示 wxid 输入提示
     */
    showWxidInputHint() {
        if (this.wxidInput) {
            // 添加视觉提示
            this.wxidInput.style.borderColor = '#ffa500';
            this.wxidInput.style.boxShadow = '0 0 5px rgba(255, 165, 0, 0.3)';
            this.wxidInput.placeholder = '请输入 wxid (格式: wx + 16位字符)';
            
            // 3秒后恢复原样
            setTimeout(() => {
                if (this.wxidInput) {
                    this.wxidInput.style.borderColor = '';
                    this.wxidInput.style.boxShadow = '';
                    this.wxidInput.placeholder = 'wxid (可选)';
                }
            }, 3000);
        }
    }

    handleFolderSelect(files) {
        console.log('文件夹选择开始，文件数量:', files ? files.length : 0);
        
        // 清空之前的状态
        this.clearLogs();
        this.closeFileSelectionModal();
        
        if (!files || files.length === 0) {
            this.addLog('❌ 错误: 文件夹为空或无法访问', 'error');
            return;
        }

        // 转换为数组并过滤 .wxapkg 文件
        const fileArray = Array.from(files);
        const wxapkgFiles = fileArray.filter(file => 
            file.name.toLowerCase().endsWith('.wxapkg')
        );

        if (wxapkgFiles.length === 0) {
            this.addLog('❌ 错误: 选择的文件夹中没有找到 .wxapkg 文件', 'error');
            return;
        }

        // 更新选择的文件（先复制后再清空 input）
        this.selectedFiles = wxapkgFiles;
        // 现在可以安全地清空 input 值，避免影响 FileList
        this.folderInput.value = '';
        
        // 启用上传按钮
        this.uploadBtn.disabled = false;
        this.downloadBtn.disabled = true;

        // 显示成功信息
        const totalSize = wxapkgFiles.reduce((sum, file) => sum + file.size, 0);
        this.addLog(`✅ 成功选择文件夹，找到 ${wxapkgFiles.length} 个 .wxapkg 文件 (总大小: ${this.formatFileSize(totalSize)})`, 'success');
        
        this.showStatus(`已选择 ${wxapkgFiles.length} 个 .wxapkg 文件`, 'success');
        
        // 自动填充wxid
        this.autoFillWxid(wxapkgFiles);
        
        console.log('文件夹选择完成，有效文件数:', wxapkgFiles.length);
    }

    showFileSelectionOptions() {
        // 检查是否已经有弹窗存在，避免多层模态框
        if (document.getElementById('fileSelectionModal')) {
            return;
        }

        // 创建简单的选择界面，设置唯一ID
        const overlay = document.createElement('div');
        overlay.id = 'fileSelectionModal';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: white;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
            text-align: center;
            max-width: 400px;
            width: 90%;
        `;

        dialog.innerHTML = `
            <h3 style="margin: 0 0 20px 0; color: #333;">选择上传方式</h3>
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <button id="selectFolder" style="
                    padding: 12px 20px;
                    border: 2px solid #17a2b8;
                    background: #17a2b8;
                    color: white;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 15px;
                    transition: all 0.3s;
                ">📁 选择文件夹</button>
                <div style="margin: 10px 0; padding: 10px; background: #e8f4fd; border-radius: 6px; font-size: 13px; color: #0c5460; text-align: left;">
                    • 自动从路径中解析 wxid<br>
                    • 支持批量处理多个 .wxapkg 文件<br>
                </div>
                <div style="margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 6px; font-size: 13px; color: #666; text-align: left;">
                    <strong>使用提示：💡</strong><br>
                    • <strong>拖拽</strong>：直接将文件夹拖到上传区域<br>
                    • <strong>wxid自动解析要求</strong>：如: (path/to/wx1234567890abcdef) 且路径末尾必须是 wxid 才行
                </div>
                <button id="cancelSelection" style="
                    padding: 8px 20px;
                    border: 1px solid #ccc;
                    background: #f8f9fa;
                    color: #666;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 14px;
                ">取消</button>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // 添加事件监听器
        document.getElementById('selectFolder').addEventListener('click', () => {
            this.folderInput.click();
        });

        document.getElementById('cancelSelection').addEventListener('click', () => {
            this.closeFileSelectionModal();
        });

        // 点击背景关闭
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.closeFileSelectionModal();
            }
        });
    }

    closeFileSelectionModal() {
        const modal = document.getElementById('fileSelectionModal');
        if (modal) {
            document.body.removeChild(modal);
        }
    }

    async handleDroppedFiles(files, dataTransferItems = null) {
        // 清空之前的日志
        this.clearLogs();
        
        this.addLog(`📂 拖拽检测: 开始处理拖拽内容`, 'info');
        
        // 如果有 DataTransferItems，尝试使用高级API处理文件夹
        if (dataTransferItems && dataTransferItems.length > 0) {
            try {
                const allFiles = await this.processDataTransferItems(dataTransferItems);
                if (allFiles.length > 0) {
                    this.processExtractedFiles(allFiles);
                    return;
                }
            } catch (error) {
                this.addLog(`⚠️ 高级API处理失败: ${error.message}`, 'warning');
                this.addLog(`🔄 回退到基础文件处理模式`, 'info');
            }
        }
        
        // 回退到基础文件处理
        this.processBasicFiles(files);
    }

    async processDataTransferItems(items) {
        const allFiles = [];
        
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry();
                if (entry) {
                    if (entry.isDirectory) {
                        const folderFiles = await this.readDirectoryRecursively(entry, entry.name);
                        allFiles.push(...folderFiles);
                    } else if (entry.isFile) {
                        this.addLog(`📄 处理文件: ${entry.name}`, 'info');
                        const file = await this.getFileFromEntry(entry);
                        if (file) {
                            // 为单个文件也设置路径信息
                            try {
                                Object.defineProperty(file, 'webkitRelativePath', {
                                    value: entry.name,
                                    writable: false,
                                    enumerable: true,
                                    configurable: true
                                });
                            } catch (pathError) {
                                file.relativePath = entry.name;
                            }
                            allFiles.push(file);
                        }
                    }
                }
            }
        }
        
        return allFiles;
    }

    async readDirectoryRecursively(directoryEntry, path = '') {
        const files = [];
        
        return new Promise((resolve, reject) => {
            const reader = directoryEntry.createReader();
            
            const readEntries = () => {
                reader.readEntries(async (entries) => {
                    if (entries.length === 0) {
                        resolve(files);
                        return;
                    }
                    
                    try {
                        for (const entry of entries) {
                            const currentPath = path ? `${path}/${entry.name}` : entry.name;
                            
                            if (entry.isFile) {
                                try {
                                    const file = await this.getFileFromEntry(entry);
                                    if (file) {
                                        // 添加相对路径信息 - 使用Object.defineProperty因为webkitRelativePath是只读的
                                        try {
                                            Object.defineProperty(file, 'webkitRelativePath', {
                                                value: currentPath,
                                                writable: false,
                                                enumerable: true,
                                                configurable: true
                                            });
                                        } catch (pathError) {
                                            // 如果无法设置webkitRelativePath，添加自定义属性
                                            file.relativePath = currentPath;
                                        }
                                        files.push(file);
                                        
                                        // 只记录 .wxapkg 文件
                                        if (file.name.toLowerCase().endsWith('.wxapkg')) {
                                            this.addLog(`📄 发现 .wxapkg 文件: ${currentPath} (${this.formatFileSize(file.size)})`, 'success');
                                        }
                                    }
                                } catch (error) {
                                    this.addLog(`❌ 文件读取异常: ${currentPath} - ${error.message}`, 'error');
                                }
                            } else if (entry.isDirectory) {
                                try {
                                    const subFiles = await this.readDirectoryRecursively(entry, currentPath);
                                    files.push(...subFiles);
                                } catch (error) {
                                    this.addLog(`❌ 子目录处理失败: ${currentPath} - ${error.message}`, 'error');
                                }
                            }
                        }
                        
                        // 继续读取更多条目（某些浏览器分批返回）
                        readEntries();
                    } catch (error) {
                        this.addLog(`❌ 处理目录条目时出错: ${path || directoryEntry.name} - ${error.message}`, 'error');
                        reject(error);
                    }
                }, (error) => {
                    this.addLog(`❌ 读取目录失败: ${path || directoryEntry.name} - ${error.message}`, 'error');
                    reject(error);
                });
            };
            
            readEntries();
        });
    }

    async getFileFromEntry(fileEntry) {
        return new Promise((resolve, reject) => {
            fileEntry.file(resolve, reject);
        });
    }

    processExtractedFiles(allFiles) {
        // 过滤 .wxapkg 文件
        const wxapkgFiles = allFiles.filter(file => {
            const fileName = file.name.toLowerCase();
            return fileName.endsWith('.wxapkg');
        });

        if (wxapkgFiles.length === 0) {
            this.addLog('❌ 错误: 拖拽的内容中没有找到 .wxapkg 文件', 'error');
            this.showStatus('未找到 .wxapkg 文件', 'error');
            return;
        }

        // 设置选择的文件
        this.selectedFiles = wxapkgFiles;
        this.uploadBtn.disabled = false;
        this.downloadBtn.disabled = true;

        // 显示成功信息
        const totalSize = wxapkgFiles.reduce((sum, file) => sum + file.size, 0);
        this.addLog(`✅ 成功选择文件夹，找到 ${wxapkgFiles.length} 个 .wxapkg 文件 (总大小: ${this.formatFileSize(totalSize)})`, 'success');
        
        this.showStatus(`已选择 ${wxapkgFiles.length} 个 .wxapkg 文件`, 'success');

        // 自动填充wxid
        this.autoFillWxid(wxapkgFiles);
    }

    processBasicFiles(files) {
        // 检查拖拽的文件类型
        const fileArray = Array.from(files);
        
        this.addLog(`📂 基础模式: 共接收到 ${fileArray.length} 个项目`, 'info');
        
        // 检查是否有 .wxapkg 文件（大小写不敏感）
        const wxapkgFiles = fileArray.filter(file => {
            const fileName = file.name.toLowerCase();
            const isWxapkg = fileName.endsWith('.wxapkg');
            this.addLog(`  检查: "${file.name}" -> ${isWxapkg ? '✅ 是 .wxapkg 文件' : '❌ 不是 .wxapkg 文件'}`, 'info');
            return isWxapkg;
        });
        
        this.addLog(`🔍 找到 ${wxapkgFiles.length} 个 .wxapkg 文件`, 'info');
        
        if (wxapkgFiles.length === 1 && fileArray.length === 1) {
            // 单个 .wxapkg 文件
            this.addLog('📄 处理方式: 单个文件模式', 'info');
            this.selectedFiles = [wxapkgFiles[0]];
            this.uploadBtn.disabled = false;
            this.downloadBtn.disabled = true;
            this.addLog(`✅ 已选择文件: ${wxapkgFiles[0].name}`, 'success');
            this.showStatus(`已选择文件: ${wxapkgFiles[0].name}`, 'success');
            
            // 自动填充wxid
            this.autoFillWxid(wxapkgFiles);
        } else if (wxapkgFiles.length > 0) {
            // 多个 .wxapkg 文件或混合文件
            this.addLog('📁 处理方式: 多文件模式', 'info');
            this.selectedFiles = wxapkgFiles;
            this.uploadBtn.disabled = false;
            this.downloadBtn.disabled = true;
            
            const totalSize = wxapkgFiles.reduce((sum, file) => sum + file.size, 0);
            this.addLog(`✅ 已选择 ${wxapkgFiles.length} 个 .wxapkg 文件 (总大小: ${this.formatFileSize(totalSize)})`, 'success');
            this.showStatus(`已选择 ${wxapkgFiles.length} 个 .wxapkg 文件`, 'success');
            
            // 列出所有选择的文件
            wxapkgFiles.forEach(file => {
                this.addLog(`  📄 ${file.name} (${this.formatFileSize(file.size)})`, 'info');
            });
            
            // 自动填充wxid
            this.autoFillWxid(wxapkgFiles);
        } else {
            // 没有 .wxapkg 文件
            this.showStatus('拖拽的文件中没有找到 .wxapkg 文件', 'error');
            this.addLog('❌ 错误: 拖拽的文件中没有找到 .wxapkg 文件', 'error');
            this.addLog('💡 提示: 请拖拽 .wxapkg 文件，或使用文件夹选择按钮选择包含 .wxapkg 文件的文件夹', 'info');
        }
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    new WedecodeApp();
});