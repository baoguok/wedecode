import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { spawn, ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Workspace {
  id: string;
  name: string;
  type: 'miniapp' | 'game' | 'general';
  description?: string;
  createdAt: Date;
  updatedAt: Date;
  path: string;
  unpackOnly?: boolean;
  appInfo?: {
    appid?: string;
    nickname?: string;
    username?: string;
    description?: string;
  };
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: FileNode[];
}

export interface ExecutionSession {
  id: string;
  workspaceId: string;
  command: string;
  process?: ChildProcess;
  status: 'running' | 'completed' | 'error';
  output: string[];
  startTime: Date;
  endTime?: Date;
}

export class WorkspaceServer {
  private app: express.Application;
  private server: any;
  private wss: WebSocketServer;
  private workspaces: Map<string, Workspace> = new Map();
  private executions: Map<string, ExecutionSession> = new Map();
  private workspacesDir: string;
  private uploadsDir: string;
  private outputDir: string;

  constructor(port: number = 3000) {
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    // 设置目录路径
    this.workspacesDir = process.env.WORKSPACE_ROOT
      ? path.join(process.env.WORKSPACE_ROOT, 'workspaces')
      : path.join(process.cwd(), 'workspaces');
    this.uploadsDir = path.join(this.workspacesDir, 'uploads');
    this.outputDir = path.join(this.workspacesDir, 'output');

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
    this.ensureDirectories();
    this.loadWorkspaces();

    this.server.listen(port, () => {
      console.log('');
      console.log('🤖 可视化反编译小程序');
      console.log(`🚀 访问地址: http://localhost:${port}`);
      console.log('');
    });
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json({ limit: '500mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '500mb' }));
    this.app.use('/static', express.static(path.join(__dirname, '../../public')));
    // 为根路径提供静态文件服务
    this.app.use(express.static(path.join(__dirname, '../../public')));
  }

  private setupRoutes(): void {
    // 工作区管理
    this.app.get('/api/workspaces', this.getWorkspaces.bind(this));
    this.app.post('/api/workspaces', this.createWorkspace.bind(this));
    this.app.get('/api/workspaces/:id', this.getWorkspace.bind(this));
    this.app.delete('/api/workspaces/:id', this.deleteWorkspace.bind(this));

    // 文件管理
    this.app.get('/api/workspaces/:id/files', this.getFileTree.bind(this));
    this.app.get('/api/workspaces/:id/file', this.getFile.bind(this));
    this.app.post('/api/workspaces/:id/file', this.saveFile.bind(this));
    this.app.put('/api/workspaces/:id/file', this.createFile.bind(this));
    this.app.delete('/api/workspaces/:id/file', this.deleteFile.bind(this));

    // 代码执行
    this.app.post('/api/workspaces/:id/execute', this.executeCommand.bind(this));
    this.app.get('/api/workspaces/:id/executions', this.getExecutions.bind(this));
    this.app.delete('/api/executions/:executionId', this.killExecution.bind(this));

    // 反编译功能
    const upload = multer({ 
      dest: this.uploadsDir,
      limits: {
        fileSize: 100 * 1024 * 1024, // 单个文件最大 100MB
        files: 100, // 最多 100 个文件
        fieldSize: 500 * 1024 * 1024 // 总请求大小最大 500MB
      }
    });

    this.app.post('/api/workspaces/:id/decompile',
      upload.fields([{ name: 'wxapkg', maxCount: 100 }, { name: 'options', maxCount: 1 }]), 
      this.handleUploadError.bind(this),
      this.decompileWxapkg.bind(this));

    // 下载功能
    this.app.get('/api/workspaces/:id/download', this.downloadWorkspace.bind(this));

    // 工作区应用信息更新
    this.app.put('/api/workspaces/:id/appinfo', this.updateWorkspaceAppInfo.bind(this));

    // 健康检查
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // 提供前端页面
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '../../public/index.html'));
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws) => {
      console.log('WebSocket client connected');

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleWebSocketMessage(ws, data);
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      });

      ws.on('close', () => {
        console.log('WebSocket client disconnected');
      });
    });
  }

  private handleWebSocketMessage(ws: any, data: any): void {
    switch (data.type) {
      case 'subscribe':
        // 订阅工作区事件
        ws.workspaceId = data.workspaceId;
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  }

  private broadcastToWorkspace(workspaceId: string, message: any): void {
    this.wss.clients.forEach((client: any) => {
      if (client.workspaceId === workspaceId && client.readyState === 1) {
        client.send(JSON.stringify(message));
      }
    });
  }

  private ensureDirectories(): void {
    [this.workspacesDir, this.uploadsDir, this.outputDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  private loadWorkspaces(): void {
    try {
      const configPath = path.join(this.workspacesDir, 'workspaces.json');
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf-8');
        const workspacesData = JSON.parse(data);
        workspacesData.forEach((workspace: any) => {
          this.workspaces.set(workspace.id, {
            ...workspace,
            createdAt: new Date(workspace.createdAt),
            updatedAt: new Date(workspace.updatedAt)
          });
        });
      }
    } catch (error) {
      console.error('Failed to load workspaces:', error);
    }
  }

  private saveWorkspaces(): void {
    try {
      const configPath = path.join(this.workspacesDir, 'workspaces.json');
      const workspacesData = Array.from(this.workspaces.values());
      fs.writeFileSync(configPath, JSON.stringify(workspacesData, null, 2));
    } catch (error) {
      console.error('Failed to save workspaces:', error);
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  private handleUploadError(error: any, req: express.Request, res: express.Response, next: express.NextFunction): void {
    if (error instanceof multer.MulterError) {
      switch (error.code) {
        case 'LIMIT_FILE_SIZE':
          res.status(413).json({ 
            error: '文件大小超过限制',
            message: '单个文件大小不能超过 100MB',
            code: 'FILE_TOO_LARGE'
          });
          return;
        case 'LIMIT_FILE_COUNT':
          res.status(413).json({ 
            error: '文件数量超过限制',
            message: '最多只能上传 100 个文件',
            code: 'TOO_MANY_FILES'
          });
          return;
        case 'LIMIT_FIELD_VALUE':
          res.status(413).json({ 
            error: '请求数据过大',
            message: '总请求大小不能超过 500MB',
            code: 'REQUEST_TOO_LARGE'
          });
          return;
        default:
          res.status(400).json({ 
            error: '文件上传错误',
            message: error.message,
            code: 'UPLOAD_ERROR'
          });
          return;
      }
    }
    next(error);
  }

  // API 路由处理器
  private async getWorkspaces(req: express.Request, res: express.Response): Promise<void> {
    try {
      const workspaces = Array.from(this.workspaces.values());
      res.json(workspaces);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get workspaces' });
    }
  }

  private async createWorkspace(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { name, type, description } = req.body;
      const id = this.generateId();
      const workspacePath = path.join(this.workspacesDir, id);

      const workspace: Workspace = {
        id,
        name,
        type,
        description,
        createdAt: new Date(),
        updatedAt: new Date(),
        path: workspacePath
      };

      // 创建工作区目录
      fs.mkdirSync(workspacePath, { recursive: true });

      this.workspaces.set(id, workspace);
      this.saveWorkspaces();

      res.json(workspace);
    } catch (error) {
      console.error('Create workspace error:', error);
      res.status(500).json({ error: 'Failed to create workspace' });
    }
  }

  private async getWorkspace(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { id } = req.params;
      const workspace = this.workspaces.get(id);

      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      res.json(workspace);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get workspace' });
    }
  }

  private async deleteWorkspace(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { id } = req.params;
      const workspace = this.workspaces.get(id);

      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // 删除工作区目录
      if (fs.existsSync(workspace.path)) {
        fs.rmSync(workspace.path, { recursive: true, force: true });
      }

      this.workspaces.delete(id);
      this.saveWorkspaces();

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete workspace' });
    }
  }

  private async getFileTree(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { id } = req.params;
      const workspace = this.workspaces.get(id);

      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      const fileTree = this.buildFileTree(workspace.path, workspace.path);
      res.json(fileTree);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get file tree' });
    }
  }

  private buildFileTree(dirPath: string, rootPath: string): FileNode {
    const stats = fs.statSync(dirPath);
    const name = path.basename(dirPath);
    const relativePath = path.relative(rootPath, dirPath);

    const node: FileNode = {
      name,
      path: relativePath || '.',
      type: stats.isDirectory() ? 'directory' : 'file'
    };

    if (stats.isDirectory()) {
      try {
        const children = fs.readdirSync(dirPath)
          .filter(child => !child.startsWith('.'))
          .map(child => this.buildFileTree(path.join(dirPath, child), rootPath))
          .sort((a, b) => {
            if (a.type !== b.type) {
              return a.type === 'directory' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
          });
        node.children = children;
      } catch (error) {
        node.children = [];
      }
    } else {
      node.size = stats.size;
    }

    return node;
  }

  private async getFile(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { id } = req.params;
      const filepath = req.query.path as string;
      const workspace = this.workspaces.get(id);

      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      const fullPath = path.join(workspace.path, filepath);

      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      res.json({ content, path: filepath });
    } catch (error) {
      res.status(500).json({ error: 'Failed to read file' });
    }
  }

  private async saveFile(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { id } = req.params;
      const { filepath, content } = req.body;
      const workspace = this.workspaces.get(id);

      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      const fullPath = path.join(workspace.path, filepath);
      const dir = path.dirname(fullPath);

      // 确保目录存在
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(fullPath, content, 'utf-8');

      // 更新工作区时间
      workspace.updatedAt = new Date();
      this.saveWorkspaces();

      // 广播文件变更
      this.broadcastToWorkspace(id, {
        type: 'fileChanged',
        path: filepath,
        content
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to save file' });
    }
  }

  private async createFile(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { id } = req.params;
      const { filepath, content = '', type = 'file' } = req.body;
      const workspace = this.workspaces.get(id);

      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      const fullPath = path.join(workspace.path, filepath);

      if (type === 'directory') {
        fs.mkdirSync(fullPath, { recursive: true });
      } else {
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content, 'utf-8');
      }

      // 更新工作区时间
      workspace.updatedAt = new Date();
      this.saveWorkspaces();

      // 广播文件创建
      this.broadcastToWorkspace(id, {
        type: 'fileCreated',
        path: filepath,
        fileType: type
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to create file' });
    }
  }

  private async deleteFile(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { id } = req.params;
      const filepath = req.query.path as string;
      const workspace = this.workspaces.get(id);

      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      const fullPath = path.join(workspace.path, filepath);

      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(fullPath);
      }

      // 更新工作区时间
      workspace.updatedAt = new Date();
      this.saveWorkspaces();

      // 广播文件删除
      this.broadcastToWorkspace(id, {
        type: 'fileDeleted',
        path: filepath
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete file' });
    }
  }

  private async executeCommand(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { id } = req.params;
      const { command } = req.body;
      const workspace = this.workspaces.get(id);

      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      const executionId = this.generateId();
      const execution: ExecutionSession = {
        id: executionId,
        workspaceId: id,
        command: command,
        status: 'running',
        output: [],
        startTime: new Date()
      };

      this.executions.set(executionId, execution);

      // 解析命令字符串
      const commandParts = command.trim().split(/\s+/);
      const cmd = commandParts[0];
      const args = commandParts.slice(1);

      const childProcess = spawn(cmd, args, {
        cwd: workspace.path,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      execution.process = childProcess;

      // 处理输出
      childProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        execution.output.push(text);
        this.broadcastToWorkspace(id, {
          type: 'executionOutput',
          executionId,
          data: text,
          stream: 'stdout'
        });
      });

      childProcess.stderr?.on('data', (data) => {
        const text = data.toString();
        execution.output.push(text);
        this.broadcastToWorkspace(id, {
          type: 'executionOutput',
          executionId,
          data: text,
          stream: 'stderr'
        });
      });

      childProcess.on('close', (code) => {
        execution.status = code === 0 ? 'completed' : 'error';
        execution.endTime = new Date();
        delete execution.process;

        this.broadcastToWorkspace(id, {
          type: 'executionComplete',
          executionId,
          status: execution.status,
          exitCode: code
        });
      });

      res.json({ executionId, status: 'started' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to execute command' });
    }
  }

  private async getExecutions(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { id } = req.params;
      const executions = Array.from(this.executions.values())
        .filter(exec => exec.workspaceId === id);
      res.json(executions);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get executions' });
    }
  }

  private async killExecution(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { executionId } = req.params;
      const execution = this.executions.get(executionId);

      if (!execution || !execution.process) {
        res.status(404).json({ error: 'Execution not found or not running' });
        return;
      }

      execution.process.kill('SIGTERM');
      execution.status = 'error';
      execution.endTime = new Date();
      delete execution.process;

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to kill execution' });
    }
  }

  private async decompileWxapkg(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { id } = req.params;
      const workspace = this.workspaces.get(id);

      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      // 支持单文件和多文件上传
      const filesObj = req.files as { [fieldname: string]: Express.Multer.File[] };
      const wxapkgFiles = filesObj?.wxapkg || [];

      if (!wxapkgFiles || wxapkgFiles.length === 0) {
        res.status(400).json({ error: 'No wxapkg file(s) uploaded' });
        return;
      }

      // 解析配置选项
      let options: string[] = [];
      if (req.body.options) {
        try {
          options = JSON.parse(req.body.options);
        } catch (error) {
          console.warn('Failed to parse options:', error);
        }
      }

      // 检测是否为解包模式
      const isUnpackOnly = options.includes('--unpack-only');
      workspace.unpackOnly = isUnpackOnly;
      this.saveWorkspaces();

      // 创建执行会话
      const executionId = this.generateId();
      const outputPath = path.join(workspace.path, 'OUTPUT');

      // 确保输出目录存在
      if (!fs.existsSync(outputPath)) {
        fs.mkdirSync(outputPath, { recursive: true });
      }

      // 构建命令 - 支持单文件和多文件
      const filePaths: string[] = wxapkgFiles.map(file => file.path);

      // 构建命令 - 使用当前node的绝对路径
      // 参数顺序：inputPaths... outputPath workspaceId options...
      const command = [process.execPath, 'dist/decompilation-cli.js', ...filePaths, outputPath, id, ...options];

      const execution: ExecutionSession = {
        id: executionId,
        workspaceId: id,
        command: command.join(' '),
        status: 'running',
        output: [],
        startTime: new Date()
      };

      this.executions.set(executionId, execution);

      // 启动反编译进程
      const childProcess = spawn(command[0], command.slice(1), {
        cwd: path.join(__dirname, '../..'),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          WEDECODE_CHILD_PROCESS: 'true'  // 标识这是一个子进程
        }
      });

      execution.process = childProcess;

      // 处理进程输出
      childProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        execution.output.push(output);

        // 在Node.js控制台输出日志
        console.log(`[反编译进程] ${output.trim()}`);

        // 通过 WebSocket 广播输出
        this.broadcastToWorkspace(id, {
          type: 'execution',
          executionId,
          event: 'output',
          data: output
        });
      });

      childProcess.stderr?.on('data', (data) => {
        const output = data.toString();
        execution.output.push(output);

        // 在Node.js控制台输出错误日志
        console.error(`[反编译进程错误] ${output.trim()}`);

        // 通过 WebSocket 广播错误输出
        this.broadcastToWorkspace(id, {
          type: 'execution',
          executionId,
          event: 'error',
          data: output
        });
      });

      childProcess.on('close', (code) => {
        execution.status = code === 0 ? 'completed' : 'error';
        execution.endTime = new Date();

        // 在Node.js控制台输出进程结束信息
        if (code === 0) {
          console.log(`[反编译进程] 反编译完成，退出码: ${code}`);
        } else {
          console.error(`[反编译进程] 反编译失败，退出码: ${code}`);
        }

        // 通过 WebSocket 广播进程结束
        this.broadcastToWorkspace(id, {
          type: 'execution',
          executionId,
          event: 'exit',
          code
        });

        // 清理上传的文件
        try {
          wxapkgFiles.forEach(file => {
            try {
              fs.unlinkSync(file.path);
            } catch (error) {
              console.warn(`Failed to cleanup uploaded file ${file.path}:`, error);
            }
          });
        } catch (error) {
          console.warn('Failed to cleanup uploaded files:', error);
        }
      });

      childProcess.on('error', (error) => {
        execution.status = 'error';
        execution.endTime = new Date();

        // 在Node.js控制台输出进程错误信息
        console.error(`[反编译进程] 进程错误: ${error.message}`);

        // 通过 WebSocket 广播进程错误
        this.broadcastToWorkspace(id, {
          type: 'execution',
          executionId,
          event: 'error',
          data: error.message
        });
      });

      res.json({
        success: true,
        executionId,
        message: 'Decompilation started'
      });
    } catch (error) {
      console.error('Decompilation error:', error);
      res.status(500).json({ error: 'Failed to start decompilation' });
    }
  }



  private async updateWorkspaceAppInfo(req: express.Request, res: express.Response): Promise<void> {
    const workspaceId = req.params.id;
    const workspace = this.workspaces.get(workspaceId);

    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    try {
      const { appInfo } = req.body;

      // 更新工作区的小程序信息
      workspace.appInfo = appInfo;
      workspace.updatedAt = new Date();

      // 保存到文件
      this.saveWorkspaces();

      res.json({
        success: true,
        message: 'App info updated successfully',
        appInfo: workspace.appInfo
      });
    } catch (error) {
      console.error('Update app info error:', error);
      res.status(500).json({ error: 'Failed to update app info' });
    }
  }

  private async downloadWorkspace(req: express.Request, res: express.Response): Promise<void> {
    const workspaceId = req.params.id;
    const workspace = this.workspaces.get(workspaceId);

    if (!workspace) {
      console.error(`[下载错误] 工作区未找到: ${workspaceId}`);
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    try {
      // 查找反编译结果文件夹，优先查找 OUTPUT，然后查找 decompiled
      let outputPath = path.join(workspace.path, 'OUTPUT');
      let folderType = 'OUTPUT';

      if (!fs.existsSync(outputPath)) {
        outputPath = path.join(workspace.path, 'decompiled');
        folderType = 'decompiled';
      }

      console.log(`[下载] 检查输出路径: ${outputPath} (${folderType})`);

      if (!fs.existsSync(outputPath)) {
        console.error(`[下载错误] 反编译结果文件夹不存在: ${outputPath}`);
        // 检查工作区目录是否存在
        if (!fs.existsSync(workspace.path)) {
          console.error(`[下载错误] 工作区目录不存在: ${workspace.path}`);
          res.status(404).json({ error: 'Workspace directory not found' });
          return;
        }
        // 列出工作区目录内容
        try {
          const workspaceContents = fs.readdirSync(workspace.path);
          console.log(`[下载] 工作区目录内容: ${workspaceContents.join(', ')}`);
        } catch (err) {
          console.error(`[下载错误] 无法读取工作区目录: ${err}`);
        }
        res.status(404).json({ error: 'Decompilation result folder not found. Please ensure decompilation completed successfully.' });
        return;
      }

      // 检查反编译结果文件夹是否为空
      try {
        const outputContents = fs.readdirSync(outputPath);
        console.log(`[下载] ${folderType}文件夹内容: ${outputContents.join(', ')}`);
        if (outputContents.length === 0) {
          console.error(`[下载错误] ${folderType}文件夹为空: ${outputPath}`);
          res.status(404).json({ error: `${folderType} folder is empty. Please ensure decompilation completed successfully.` });
          return;
        }
      } catch (err) {
        console.error(`[下载错误] 无法读取${folderType}文件夹: ${err}`);
        res.status(500).json({ error: `Cannot read ${folderType} folder` });
        return;
      }

      // 使用 zip 命令创建压缩包
      let fileName = '反编译结果';

      // 如果有小程序信息，使用小程序名称或appid
      if (workspace.appInfo) {
        if (workspace.appInfo.nickname) {
          fileName = workspace.appInfo.nickname;
        } else if (workspace.appInfo.appid) {
          fileName = workspace.appInfo.appid;
        }
      }

      // 如果是解包模式，添加后缀
      if (workspace.unpackOnly) {
        fileName += '-仅解包';
      }

      // 清理文件名中的非法字符
      fileName = fileName.replace(/[<>:"/\\|?*]/g, '_');

      // 生成月日时分秒格式的时间戳 (MMDD-HHMMSS)
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const timestamp = `${month}${day}-${hours}${minutes}${seconds}`;

      const zipFileName = `${fileName}_${timestamp}.zip`;
      const zipPath = path.join(this.uploadsDir, zipFileName);

      console.log(`[下载] 创建压缩包: ${zipFileName}`);
      console.log(`[下载] 压缩包路径: ${zipPath}`);

      // 创建 zip 文件
      const zipProcess = spawn('zip', ['-r', zipPath, '.'], {
        cwd: outputPath,
        stdio: 'pipe'
      });

      let zipOutput = '';
      let zipError = '';

      zipProcess.stdout?.on('data', (data) => {
        zipOutput += data.toString();
      });

      zipProcess.stderr?.on('data', (data) => {
        zipError += data.toString();
      });

      zipProcess.on('close', (code) => {
        console.log(`[下载] zip进程退出码: ${code}`);
        if (zipOutput) console.log(`[下载] zip输出: ${zipOutput}`);
        if (zipError) console.error(`[下载] zip错误: ${zipError}`);

        if (code === 0 && fs.existsSync(zipPath)) {
          const zipStats = fs.statSync(zipPath);
          console.log(`[下载] 压缩包创建成功，大小: ${zipStats.size} bytes`);

          // 设置响应头
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFileName)}"`);
          res.setHeader('Content-Length', zipStats.size.toString());

          // 发送文件
          const fileStream = fs.createReadStream(zipPath);
          fileStream.pipe(res);

          // 清理临时文件
          fileStream.on('end', () => {
            console.log(`[下载] 文件发送完成，清理临时文件: ${zipPath}`);
            fs.unlink(zipPath, (err) => {
              if (err) console.error('Failed to delete temp zip file:', err);
            });
          });

          fileStream.on('error', (err) => {
            console.error(`[下载错误] 文件流错误: ${err}`);
            res.status(500).json({ error: 'File stream error' });
          });
        } else {
          console.error(`[下载错误] 压缩包创建失败，退出码: ${code}, 文件存在: ${fs.existsSync(zipPath)}`);
          res.status(500).json({ error: `Failed to create zip file. Exit code: ${code}` });
        }
      });

      zipProcess.on('error', (error) => {
        console.error(`[下载错误] zip进程错误: ${error}`);
        res.status(500).json({ error: `Zip process error: ${error.message}` });
      });

    } catch (error) {
      console.error(`[下载错误] 下载异常: ${error}`);
      res.status(500).json({ error: `Failed to download workspace: ${error instanceof Error ? error.message : 'Unknown error'}` });
    }
  }
}