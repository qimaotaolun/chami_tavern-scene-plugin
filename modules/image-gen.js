"use strict";
import { EventTypes } from "../core/event-bus.js";
import { StoreNames } from "../core/db-manager.js";
import { getRequestHeaders, saveChatConditional, updateMessageBlock, chat, eventSource, event_types, addCopyToCodeBlocks } from "../../../../../script.js";
import { MultiCharacterParser } from "./multi-character-parser.js";
import { ImageStorageManager } from "./image-storage.js";
import { ImageInteractionManager } from "./image-interaction.js";
const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
export class ImageGenerator {
  static DEFAULT_NAI_OFFICIAL_URL = "https://image.novelai.net/ai/generate-image";
  static DEFAULT_NAI_PROXY_URL = "1";
  static I2I_STORE_NAME = "i2i_cache";
  constructor(_0x49b50d) {
    this.ctx = _0x49b50d;
    this.i2iSettings = {
      strength: 0.7,
      noise: 0,
      inpaintStrength: 1
    };
    const _0x5ef701 = {
      url: "http://127.0.0.1:7860",
      model: "",
      sampler: "Euler a",
      scheduler: "automatic",
      steps: 20,
      cfgScale: 7,
      width: 832,
      height: 1216,
      seed: -1,
      restoreFaces: false,
      enableHr: false,
      hrScale: 2,
      hrUpscaler: "Latent",
      hrDenoisingStrength: 0.5,
      hrSecondPassSteps: 15,
      adetailerEnabled: false,
      adModel: "face_yolov8n.pt",
      adDenoisingStrength: 0.4,
      adMaskBlur: 4,
      adInpaintPadding: 32,
      controlNetEnabled: false,
      controlNetUnits: []
    };
    const _0x4c91ab = {
      currentMode: "sd",
      enabled: true,
      sd: _0x5ef701,
      nai: {
        apiKey: "",
        model: "nai-diffusion-3",
        channel: "proxy",
        proxyUrl: "",
        proxyStream: true,
        sampler: "k_euler_ancestral",
        steps: 28,
        scale: 5,
        cfgRescale: 0,
        noiseSchedule: "karras",
        width: 832,
        height: 1216,
        sizePreset: "竖图",
        multiRoleEnabled: false,
        multiRoleList: [],
        vibeEnabled: false,
        vibeImages: [],
        i2iBase64: null,
        variety: false,
        decrisper: false,
        sm: false,
        dyn: false,
        useCoords: false
      },
      comfyui: {
        url: "http://127.0.0.1:8188",
        activeWorkflow: "",
        workflows: []
      },
      other: {
        url: "",
        apiKey: "",
        model: "",
        width: 1024,
        height: 1024,
        timeout: 120,
        steps: 20,
        cfgScale: 7,
        customHeaders: "",
        customBody: "",
        presets: [],
        activePreset: "",
        placeholders: [],
        pureMode: false
      },
      autoGenerate: false,
      insertIntoChat: true,
      activePresetName: "",
      activePresetAfter: ""
    };
    this.settings = _0x4c91ab;
    this.isGenerating = false;
    this.generationQueue = [];
    this.currentTaskId = null;
    this.isGenerationInProgress = true;
    this.isAiGenerating = false;
    this._wasStoppedManually = false;
    this._genStartTime = 0;
    this._isCharacterSwitching = false;
    this._isSyncingUI = false;
    this._processingHashes = new Set();
    this._aiProcessingHashes = new Set();
    this._nextImageId = null;
  }
  async init() {
    this.ctx.log("image-gen", "初始化");
    this.storageManager = new ImageStorageManager(this.ctx);
    await this.storageManager.init();
    this.interactionManager = new ImageInteractionManager(this.ctx);
    await this.interactionManager.init();
    await this.loadSettings();
    this._unsubscribePromptSubmit = this.ctx.events.on(EventTypes.PROMPT_SUBMIT, async ({
      positive: _0x501552,
      negative: _0x4c266b,
      source: _0x2ef378
    }) => {
      this.ctx.log("image-gen", "收到提示词提交 from " + _0x2ef378);
      await this.generateFromPrompt(_0x501552, _0x4c266b);
    });
    this.ctx.events.on(EventTypes.SETTINGS_SAVED, async () => {
      await this._loadScanConfig();
      this.ctx.log("image-gen", "配置已热重新加载");
    });
    this.ctx.events.on(EventTypes.PHONE_CHAT_OPEN, async () => {
      this.ctx.log("image-gen", "[手机聊天] 聊天窗口打开，触发消息限制和按钮渲染");
      await this._limitPhoneChatMessages();
      await this.scanPhoneChatWindow();
    });
    this.ctx.events.on(EventTypes.PHONE_CHAT_MESSAGE_RECEIVED, async () => {
      this.ctx.log("image-gen", "[手机聊天] 收到新消息，触发消息限制和按钮渲染");
      await this._limitPhoneChatMessages();
      await this.scanPhoneChatWindow();
    });
    this.ctx.events.on(EventTypes.PHONE_CHAT_MESSAGES_LOADED, async () => {
      this.ctx.log("image-gen", "[手机聊天] 消息加载完成，触发按钮渲染");
      await this.scanPhoneChatWindow();
    });
    this.ctx.events.on(EventTypes.PHONE_CHAT_RENDER_BUTTONS, async () => {
      this.ctx.log("image-gen", "[手机聊天] 手动触发按钮渲染");
      await this.scanPhoneChatWindow();
    });
    this.ctx.events.on(EventTypes.PHONE_MOMENTS_OPEN, async () => {
      this.ctx.log("image-gen", "[朋友圈] 朋友圈打开，触发图片渲染");
      await this.scanPhoneMoments();
    });
    this.ctx.events.on(EventTypes.PHONE_MOMENTS_LOADED, async () => {
      this.ctx.log("image-gen", "[朋友圈] 朋友圈内容加载完成，触发图片渲染");
      await this.scanPhoneMoments();
    });
    this.ctx.events.on(EventTypes.PHONE_MOMENTS_RENDER_BUTTONS, async () => {
      this.ctx.log("image-gen", "[朋友圈] 手动触发图片渲染");
      await this.scanPhoneMoments();
    });
    this.ctx.events.on(EventTypes.PHONE_FORUM_OPEN, async () => {
      this.ctx.log("image-gen", "[论坛] 论坛打开，触发图片渲染");
      await this.scanPhoneForum();
    });
    this.ctx.events.on(EventTypes.PHONE_FORUM_LOADED, async () => {
      this.ctx.log("image-gen", "[论坛] 论坛内容加载完成，触发图片渲染");
      await this.scanPhoneForum();
    });
    this.ctx.events.on(EventTypes.PHONE_FORUM_RENDER_BUTTONS, async () => {
      this.ctx.log("image-gen", "[论坛] 手动触发图片渲染");
      await this.scanPhoneForum();
    });
    this.ctx.events.on(EventTypes.PHONE_MINUTES_RENDER_BUTTONS, async () => {
      this.ctx.log("image-gen", "[剧情百科] 手动触发图片渲染");
      await this.scanPhoneMinutes();
    });
    this.ctx.events.on(EventTypes.PHONE_LIVESTREAMING_RENDER_TAGS, async () => {
      this.ctx.log("image-gen", "[直播页面] 手动触发标签渲染");
      await this.scanPhoneLivestreaming();
    });
    this._onGenerationEndedBound = this._onGenerationEnded.bind(this);
    if (eventSource && event_types) {
      eventSource.on(event_types.GENERATION_STARTED, () => {
        this._wasStoppedManually = false;
        this._genStartTime = Date.now();
        this.ctx.log("image-gen", "[状态监控] 生成开始，重置终止标记");
      });
      eventSource.on(event_types.GENERATION_STOPPED, () => {
        this._wasStoppedManually = true;
        this.ctx.log("image-gen", "[状态监控] 检测到手动终止/停止信号");
      });
      eventSource.on(event_types.GENERATION_ENDED, this._onGenerationEndedBound);
      this.ctx.log("image-gen", "已挂载 GENERATION_ENDED 自动点击监听器");
    } else {
      console.warn("[TSP] 无法获取 eventSource，自动点击功能可能不可用");
    }
    const _0x25a5eb = window;
    if (_0x25a5eb.ChatomiPlugins) {
      _0x25a5eb.ChatomiPlugins.Main = _0x25a5eb.ChatomiPlugins.Main || {};
      _0x25a5eb.ChatomiPlugins.Main.GeneratorManager = {
        generate: (_0x4d1d20, _0x1f7950) => this.generate(_0x4d1d20, _0x1f7950)
      };
      _0x25a5eb.ChatomiPlugins.Main.CacheManager = {
        dbRead: _0x389f4a => this.getCachedImage(_0x389f4a),
        getCacheMetadataWithCursor: _0xfc0885 => this.getCacheMetadata(_0xfc0885)
      };
    }
    this._initVisibilityObserver();
    this.initMessageObserver();
    await this._createFloatingGenButton();
    const _0x37492b = await this.ctx.api.getValue("use_double_click_regen", false);
    document.body.classList.toggle("tsp-mode-double-click", _0x37492b);
    this.ctx.log("image-gen", "初始化完成");
  }
  async cleanup() {
    this.ctx.log("image-gen", "[清理] 开始执行完整清理");
    if (this._unsubscribePromptSubmit) {
      this._unsubscribePromptSubmit();
      this._unsubscribePromptSubmit = null;
    }
    if (this._messageObserver) {
      this._messageObserver.disconnect();
      this._messageObserver = null;
    }
    if (this._statusObserver) {
      this._statusObserver.disconnect();
      this._statusObserver = null;
    }
    if (this._visibilityObserver) {
      this._visibilityObserver.disconnect();
      this._visibilityObserver = null;
    }
    if (this._scanInterval) {
      clearInterval(this._scanInterval);
      this._scanInterval = null;
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this._streamingScanInterval) {
      clearInterval(this._streamingScanInterval);
      this._streamingScanInterval = null;
    }
    if (eventSource && event_types && this._onGenerationEndedBound) {
      eventSource.removeListener(event_types.GENERATION_ENDED, this._onGenerationEndedBound);
      this._onGenerationEndedBound = null;
    }
    if (eventSource && event_types) {
      if (this._onSingleMessageUpdateBound) {
        eventSource.removeListener(event_types.MESSAGE_UPDATED, this._onSingleMessageUpdateBound);
        eventSource.removeListener(event_types.USER_MESSAGE_RENDERED, this._onSingleMessageUpdateBound);
        eventSource.removeListener(event_types.CHARACTER_MESSAGE_RENDERED, this._onSingleMessageUpdateBound);
        eventSource.removeListener(event_types.MESSAGE_RECEIVED, this._onSingleMessageUpdateBound);
        this._onSingleMessageUpdateBound = null;
      }
      if (this._onFullScanBound) {
        eventSource.removeListener(event_types.CHAT_CHANGED, this._onFullScanBound);
        eventSource.removeListener(event_types.CHAT_CREATED, this._onFullScanBound);
        this._onFullScanBound = null;
      }
      if (this._onGenerationEndedBound) {
        eventSource.removeListener(event_types.GENERATION_ENDED, this._onGenerationEndedBound);
        this._onGenerationEndedBound = null;
      }
    }
    if (this._currentStreamProcessedLinks) {
      this._currentStreamProcessedLinks.clear();
    }
    if (this._streamingProcessedHashes) {
      this._streamingProcessedHashes.clear();
    }
    if (this._processingHashes) {
      this._processingHashes.clear();
    }
    if (this._aiProcessingHashes) {
      this._aiProcessingHashes.clear();
    }
    this._autoClickQueue = [];
    this._locationToImageIdMap = {};
    this.ctx.log("image-gen", "[清理] 完整清理完成");
  }
  async _createFloatingGenButton() {
    if (document.getElementById("tsp-quick-gen-fab")) {
      return;
    }
    const _0x1d8121 = await this.ctx.api.getValue("text2img_enabled", true);
    if (!_0x1d8121) {
      return;
    }
    const _0x2a6f25 = await this.ctx.api.getValue("quick_gen_visible", true);
    if (!_0x2a6f25) {
      return;
    }
    const _0x273e82 = document.createElement("div");
    _0x273e82.id = "tsp-quick-gen-fab";
    _0x273e82.title = "AI 提取最新上下文并生成图片";
    _0x273e82.innerHTML = "\n            <i class=\"fa-solid fa-palette\" id=\"tsp-qg-icon-normal\"></i>\n            <i class=\"fa-solid fa-hourglass\" id=\"tsp-qg-icon-loading\" style=\"display: none;\"></i>\n        ";
    document.body.appendChild(_0x273e82);
    const _0x3e8202 = document.documentElement.clientWidth;
    const _0x3431e6 = document.documentElement.clientHeight;
    let _0x3681c8 = {
      x: _0x3e8202 - 60,
      y: _0x3431e6 * 0.65
    };
    try {
      const _0x15cee7 = await this.ctx.api.getValue("quick_gen_pos", null);
      if (_0x15cee7 && _0x15cee7.x !== undefined && _0x15cee7.y !== undefined) {
        _0x3681c8 = _0x15cee7;
      }
    } catch (_0x26f59b) {
      console.warn("读取悬浮球位置失败", _0x26f59b);
    }
    const _0x36c6f6 = _0x3e8202 <= 900;
    if (_0x36c6f6) {
      if (_0x3681c8.x > _0x3e8202 || _0x3681c8.x < 0 || _0x3681c8.y > _0x3431e6 || _0x3681c8.y < 0) {
        _0x3681c8 = {
          x: _0x3e8202 - 55,
          y: _0x3431e6 * 0.6
        };
      }
    }
    this._applyFabPosition(_0x273e82, _0x3681c8.x, _0x3681c8.y);
    this._bindFabClick(_0x273e82);
    this._bindFabDrag(_0x273e82);
    window.addEventListener("resize", () => {
      this._ensureFabVisible(_0x273e82);
    });
  }
  async toggleQuickGenFab(_0x19735a) {
    const _0x1e86fb = document.getElementById("tsp-quick-gen-fab");
    if (_0x19735a) {
      if (!_0x1e86fb) {
        await this._createFloatingGenButton();
      } else {
        _0x1e86fb.style.display = "";
      }
    } else if (_0x1e86fb) {
      _0x1e86fb.style.display = "none";
    }
  }
  _applyFabPosition(_0x14e5c7, _0x4ca6c4, _0x32a604) {
    _0x14e5c7.style.left = _0x4ca6c4 + "px";
    _0x14e5c7.style.top = _0x32a604 + "px";
  }
  _ensureFabVisible(_0x5bc8af) {
    const _0x5c2fd5 = _0x5bc8af.getBoundingClientRect();
    const _0x5be0ba = document.documentElement.clientWidth;
    const _0xa9d568 = document.documentElement.clientHeight;
    let _0x3450f9 = _0x5c2fd5.left;
    let _0x2b4595 = _0x5c2fd5.top;
    if (_0x3450f9 < 0) {
      _0x3450f9 = 10;
    }
    if (_0x3450f9 + _0x5c2fd5.width > _0x5be0ba) {
      _0x3450f9 = _0x5be0ba - _0x5c2fd5.width - 10;
    }
    if (_0x2b4595 < 0) {
      _0x2b4595 = 10;
    }
    if (_0x2b4595 + _0x5c2fd5.height > _0xa9d568) {
      _0x2b4595 = _0xa9d568 - _0x5c2fd5.height - 10;
    }
    this._applyFabPosition(_0x5bc8af, _0x3450f9, _0x2b4595);
  }
  _bindFabClick(_0x3c3fae) {
    const _0xc9f953 = _0x3c3fae.querySelector("#tsp-qg-icon-normal");
    const _0x2d26a0 = _0x3c3fae.querySelector("#tsp-qg-icon-loading");
    const _0x51cf4c = _0xb4f6d8 => {
      if (_0xb4f6d8) {
        _0xc9f953.style.display = "none";
        _0x2d26a0.style.display = "";
        _0x3c3fae.classList.add("loading");
        _0x3c3fae.title = "正在生成中...";
      } else {
        _0xc9f953.style.display = "";
        _0x2d26a0.style.display = "none";
        _0x3c3fae.classList.remove("loading");
        _0x3c3fae.title = "AI 提取最新上下文并生成图片";
      }
    };
    _0x3c3fae.addEventListener("click", _0x57073a => {
      _0x57073a.preventDefault();
      _0x57073a.stopPropagation();
      if (_0x3c3fae.dataset.isDragging === "true") {
        return;
      }
      if (_0x2d26a0.style.display !== "none") {
        this.ctx.helpers.showToast("任务正在处理中...", "info");
        return;
      }
      const _0x329920 = document.querySelectorAll(".tsp-ai-gen-btn");
      if (_0x329920.length === 0) {
        this.ctx.helpers.showToast("没有可用的上下文", "warning");
        return;
      }
      const _0x2213a7 = _0x329920[_0x329920.length - 1];
      if (_0x2213a7.innerHTML.includes("fa-spinner") || _0x2213a7.style.pointerEvents === "none") {
        this.ctx.helpers.showToast("任务已在队列中", "info");
        _0x51cf4c(true);
        return;
      }
      this.ctx.log("image-gen", "悬浮球触发生成");
      _0x2213a7.click();
      _0x51cf4c(true);
      const _0x35e50e = setInterval(() => {
        const _0x2b793e = _0x2213a7.isConnected && _0x2213a7.innerHTML.includes("fa-spinner");
        if (!_0x2b793e) {
          clearInterval(_0x35e50e);
          _0x51cf4c(false);
        }
      }, 500);
    });
  }
  _bindFabDrag(_0x4a2c84) {
    let _0x57971b = false;
    let _0x19fb98;
    let _0x1369e5;
    let _0x5c6d8d;
    let _0x2e4d0d;
    let _0x157d65 = false;
    const _0x15b5c7 = (_0x10e580, _0x3fe704) => {
      _0x57971b = true;
      _0x157d65 = false;
      _0x4a2c84.dataset.isDragging = "false";
      _0x19fb98 = _0x10e580;
      _0x1369e5 = _0x3fe704;
      const _0x122c00 = _0x4a2c84.getBoundingClientRect();
      _0x5c6d8d = _0x122c00.left;
      _0x2e4d0d = _0x122c00.top;
      _0x4a2c84.style.transition = "none";
    };
    const _0x225944 = (_0x6e9fa, _0x1ae496) => {
      if (!_0x57971b) {
        return;
      }
      const _0x1bea76 = _0x6e9fa - _0x19fb98;
      const _0x6880cd = _0x1ae496 - _0x1369e5;
      if (Math.abs(_0x1bea76) > 5 || Math.abs(_0x6880cd) > 5) {
        _0x157d65 = true;
        _0x4a2c84.dataset.isDragging = "true";
      }
      if (_0x157d65) {
        let _0x1d83b5 = _0x5c6d8d + _0x1bea76;
        let _0x340a7a = _0x2e4d0d + _0x6880cd;
        const _0x3e4ff8 = document.documentElement.clientWidth;
        const _0x3bee5b = document.documentElement.clientHeight;
        const _0x58eb12 = _0x4a2c84.getBoundingClientRect();
        _0x1d83b5 = Math.max(0, Math.min(_0x1d83b5, _0x3e4ff8 - _0x58eb12.width));
        _0x340a7a = Math.max(0, Math.min(_0x340a7a, _0x3bee5b - _0x58eb12.height));
        this._applyFabPosition(_0x4a2c84, _0x1d83b5, _0x340a7a);
      }
    };
    const _0x2d978a = async () => {
      if (!_0x57971b) {
        return;
      }
      _0x57971b = false;
      _0x4a2c84.style.transition = "";
      if (_0x157d65) {
        const _0x437665 = _0x4a2c84.getBoundingClientRect();
        try {
          const _0x863589 = {
            x: _0x437665.left,
            y: _0x437665.top
          };
          await this.ctx.api.setValue("quick_gen_pos", _0x863589);
        } catch (_0x4b9238) {}
        setTimeout(() => {
          _0x4a2c84.dataset.isDragging = "false";
        }, 50);
      }
    };
    _0x4a2c84.addEventListener("mousedown", _0x3d229c => {
      if (_0x3d229c.button !== 0) {
        return;
      }
      _0x15b5c7(_0x3d229c.clientX, _0x3d229c.clientY);
      const _0x1600f0 = _0x1ab60e => {
        _0x1ab60e.preventDefault();
        _0x225944(_0x1ab60e.clientX, _0x1ab60e.clientY);
      };
      const _0xae6c4e = () => {
        document.removeEventListener("mousemove", _0x1600f0);
        document.removeEventListener("mouseup", _0xae6c4e);
        _0x2d978a();
      };
      document.addEventListener("mousemove", _0x1600f0);
      document.addEventListener("mouseup", _0xae6c4e);
    });
    _0x4a2c84.addEventListener("touchstart", _0x2dd5a9 => {
      const _0x387b77 = _0x2dd5a9.touches[0];
      _0x15b5c7(_0x387b77.clientX, _0x387b77.clientY);
    }, {
      passive: false
    });
    _0x4a2c84.addEventListener("touchmove", _0x59493b => {
      const _0xbf9abb = _0x59493b.touches[0];
      if (_0x157d65 || Math.abs(_0xbf9abb.clientX - _0x19fb98) > 5) {
        _0x59493b.preventDefault();
      }
      _0x225944(_0xbf9abb.clientX, _0xbf9abb.clientY);
    }, {
      passive: false
    });
    _0x4a2c84.addEventListener("touchend", _0x231f5a => {
      _0x2d978a();
    });
  }
  async loadSettings() {
    try {
      if (this.storageManager) {
        const _0x429da4 = await this.storageManager.loadPluginSettings();
        const _0x5991e1 = await this.storageManager.loadNaiPresets();
        const _0x2e133a = await this.storageManager.loadOtherPresets();
        if (_0x2e133a) {
          this.settings.other = this.settings.other || {};
          this.settings.other.presets = _0x2e133a.presets || [];
          this.settings.other.activePreset = _0x2e133a.activePreset || "";
          this.ctx.log("image-gen", "Other API 预设已从服务器同步 (" + this.settings.other.presets.length + " 条)");
        }
        if (_0x5991e1 && Array.isArray(_0x5991e1)) {
          this.settings.nai = this.settings.nai || {};
          this.settings.nai.naiPresets = _0x5991e1;
          this.ctx.log("image-gen", "NAI 参考预设已从服务器同步 (" + _0x5991e1.length + " 条)");
        }
        if (_0x429da4) {
          this.ctx.log("image-gen", "从服务器加载配置成功");
          if (_0x429da4.image_gen_settings) {
            this.settings = this._deepMerge(this.settings, _0x429da4.image_gen_settings);
            if (this.settings.comfyui && this.settings.comfyui.activeWorkflow) {
              this.ctx.log("image-gen", "已同步 ComfyUI 激活工作流: " + this.settings.comfyui.activeWorkflow);
            }
            await this.ctx.api.setValue("image_gen_settings", this.settings);
            if (this.settings.nai?.vibeImages && Array.isArray(this.settings.nai.vibeImages) && _0x5991e1) {
              this._restoreVibeEncodings(this.settings.nai.vibeImages, _0x5991e1);
            }
          }
          if (_0x429da4.advanced_settings) {
            await this._applyAdvancedSettings(_0x429da4.advanced_settings);
            this.ctx.log("image-gen", "高级设置已从服务器同步");
          }
          return;
        }
      }
      const _0xcb9678 = await this.ctx.api.getValue("image_gen_settings", {});
      this.settings = this._deepMerge(this.settings, _0xcb9678);
    } catch (_0x5074d6) {
      this.ctx.error("image-gen", "加载设置失败:", _0x5074d6);
    }
  }
  async _collectAdvancedSettings() {
    const _0x424b02 = this.ctx.getModule("triggerProcessor");
    const _0x33121a = _0x424b02?.settings || {};
    let _0x2f085d = [];
    try {
      _0x2f085d = (await this.ctx.db.getAll(StoreNames.PRESETS)) || [];
    } catch (_0x229417) {
      this.ctx.warn("image-gen", "获取提示词预设失败:", _0x229417);
    }
    return {
      chami_analysis_begins: await this.ctx.api.getValue("chami_analysis_begins", "image###"),
      chami_analysis_completed: await this.ctx.api.getValue("chami_analysis_completed", "###"),
      auto_generate_click: await this.ctx.api.getValue("auto_generate_click", true),
      max_auto_clicks: await this.ctx.api.getValue("max_auto_clicks", 3),
      chami_streaming_mode: await this.ctx.api.getValue("chami_streaming_mode", false),
      chami_max_button: await this.ctx.api.getValue("chami_max_button", 20),
      use_double_click_regen: await this.ctx.api.getValue("use_double_click_regen", false),
      preset_preview_mode: await this.ctx.api.getValue("preset_preview_mode", "thumbnail"),
      display_mode: await this.ctx.api.getValue("display_mode", "默认"),
      cache_days: await this.ctx.api.getValue("cache_days", 0),
      chami_image_zoom_ratio: await this.ctx.api.getValue("chami_image_zoom_ratio", 100),
      chami_privacy_mode: await this.ctx.api.getValue("chami_privacy_mode", false),
      fix_hashline_enabled: await this.ctx.api.getValue("fix_hashline_enabled", false),
      text2img_enabled: await this.ctx.api.getValue("text2img_enabled", true),
      inject_buttons_enabled: await this.ctx.api.getValue("inject_buttons_enabled", true),
      fab_visible: await this.ctx.api.getValue("fab_visible", true),
      auto_insert_image: await this.ctx.api.getValue("auto_insert_image", true),
      auto_generate: await this.ctx.api.getValue("auto_generate", false),
      phone_emulator_enabled: await this.ctx.api.getValue("phone_emulator_enabled", true),
      floating_ball_shelter_enabled: await this.ctx.api.getValue("floating-ball-shelter-enabled", false),
      concurrent_requests_enabled: await this.ctx.api.getValue("concurrent_requests_enabled", false),
      default_width: await this.ctx.api.getValue("default_width", 832),
      default_height: await this.ctx.api.getValue("default_height", 1216),
      default_steps: await this.ctx.api.getValue("default_steps", 20),
      prompt_positive_text: await this.ctx.api.getValue("prompt_positive_text", ""),
      prompt_negative_text: await this.ctx.api.getValue("prompt_negative_text", ""),
      quality_prefix: await this.ctx.api.getValue("quality_prefix", ""),
      negative_default: await this.ctx.api.getValue("negative_default", ""),
      multichar_config: await this.ctx.api.getValue("multichar_config", null),
      trigger_processor_settings: _0x33121a,
      prompt_presets: [],
      module_aiProcessor: await this.ctx.api.getValue("module_aiProcessor", true),
      module_triggers: await this.ctx.api.getValue("module_triggers", true),
      module_characterDB: await this.ctx.api.getValue("module_characterDB", true),
      module_tagMarket: await this.ctx.api.getValue("module_tagMarket", true),
      module_phoneEmulator: await this.ctx.api.getValue("module_phoneEmulator", true),
      module_tagVisualization: await this.ctx.api.getValue("module_tagVisualization", false)
    };
  }
  async _applyAdvancedSettings(_0x1477d5) {
    if (!_0x1477d5) {
      return;
    }
    const _0x5c8aea = ["chami_analysis_begins", "chami_analysis_completed", "auto_generate_click", "max_auto_clicks", "chami_streaming_mode", "chami_max_button", "preset_preview_mode", "use_double_click_regen", "display_mode", "cache_days", "chami_image_zoom_ratio", "chami_privacy_mode", "fix_hashline_enabled", "text2img_enabled", "inject_buttons_enabled", "fab_visible", "auto_insert_image", "auto_generate", "phone_emulator_enabled", "floating_ball_shelter_enabled", "concurrent_requests_enabled", "default_width", "default_height", "default_steps", "prompt_positive_text", "prompt_negative_text", "quality_prefix", "negative_default", "multichar_config", "module_aiProcessor", "module_triggers", "module_characterDB", "module_tagMarket", "module_phoneEmulator", "module_tagVisualization"];
    for (const _0x422fae of _0x5c8aea) {
      if (_0x1477d5[_0x422fae] !== undefined) {
        await this.ctx.api.setValue(_0x422fae, _0x1477d5[_0x422fae]);
      }
    }
    if (_0x1477d5.trigger_processor_settings) {
      await this.ctx.api.setValue("trigger_processor_settings", _0x1477d5.trigger_processor_settings);
      const _0x1c4af6 = this.ctx.getModule("triggerProcessor");
      if (_0x1c4af6) {
        _0x1c4af6.settings = {
          ..._0x1c4af6.settings,
          ..._0x1477d5.trigger_processor_settings
        };
      }
    }
    if (_0x1477d5.multichar_config) {
      await this.ctx.api.setValue("multichar_config", _0x1477d5.multichar_config);
      if (typeof MultiCharacterParser !== "undefined") {
        MultiCharacterParser.setConfig(_0x1477d5.multichar_config);
        this.ctx.log("image-gen", "多角色定义配置已从服务器同步");
      }
    }
    if (this.storageManager) {
      try {
        const _0x21a0fa = await this.storageManager.loadPromptPresets();
        if (_0x21a0fa && Array.isArray(_0x21a0fa)) {
          const _0x26bcd2 = (await this.ctx.db.getAll(StoreNames.PRESETS)) || [];
          const _0x523c04 = new Map(_0x26bcd2.map(_0x293a8c => [_0x293a8c.name, _0x293a8c]));
          for (const _0x4f808c of _0x21a0fa) {
            if (!_0x4f808c.name) {
              continue;
            }
            const _0x5df604 = _0x523c04.get(_0x4f808c.name);
            const _0x63f72 = {
              ...(_0x5df604 || {}),
              ..._0x4f808c
            };
            const _0x532701 = _0x63f72;
            if (typeof _0x532701.sequence !== "number") {
              _0x532701.sequence = 0;
            }
            await this.ctx.db.put(StoreNames.PRESETS, _0x532701);
          }
          this.ctx.log("image-gen", "独立提示词预设文件已同步 (" + _0x21a0fa.length + " 条)");
        }
      } catch (_0x4571ff) {
        this.ctx.warn("image-gen", "加载独立预设文件失败:", _0x4571ff);
      }
    }
  }
  async saveSettings() {
    try {
      await this.ctx.api.setValue("image_gen_settings", this.settings);
      this.ctx.events.emit(EventTypes.SETTINGS_SAVED, {
        module: "image-gen"
      });
      if (this.storageManager) {
        if (this.settings.nai?.naiPresets) {
          await this.storageManager.saveNaiPresets(this.settings.nai.naiPresets);
        }
        if (this.settings.other) {
          await this.storageManager.saveOtherPresets({
            presets: this.settings.other.presets || [],
            activePreset: this.settings.other.activePreset || ""
          });
        }
        const _0x17a6ec = JSON.parse(JSON.stringify(this.settings));
        if (_0x17a6ec.nai) {
          delete _0x17a6ec.nai.naiPresets;
          if (Array.isArray(_0x17a6ec.nai.vibeImages)) {
            _0x17a6ec.nai.vibeImages.forEach(_0x4d33d5 => {
              if (_0x4d33d5.vibeData) {
                delete _0x4d33d5.vibeData.encodings;
                delete _0x4d33d5.vibeData.image;
                delete _0x4d33d5.vibeData.thumbnail;
              }
            });
          }
        }
        if (_0x17a6ec.other) {
          delete _0x17a6ec.other.presets;
        }
        const _0x2f3e4d = await this._collectAdvancedSettings();
        const _0x405d97 = (await this.ctx.db.getAll(StoreNames.PRESETS)) || [];
        const _0x591b4c = await this.storageManager.savePromptPresets(_0x405d97);
        if (_0x591b4c) {
          for (const _0x4c7aac of _0x591b4c) {
            await this.ctx.db.put(StoreNames.PRESETS, _0x4c7aac);
          }
        }
        const _0x146998 = {
          image_gen_settings: _0x17a6ec,
          image_storage_settings: this.storageManager.settings,
          advanced_settings: _0x2f3e4d
        };
        const _0x152f9a = _0x146998;
        this.storageManager.savePluginSettings(_0x152f9a).catch(_0x1d9471 => {
          this.ctx.warn("image-gen", "保存配置到服务器失败:", _0x1d9471);
        });
      }
    } catch (_0x1f7379) {
      this.ctx.error("image-gen", "保存设置失败:", _0x1f7379);
    }
  }
  _restoreVibeEncodings(_0x24b5be, _0xabc5fb) {
    if (!Array.isArray(_0x24b5be) || !Array.isArray(_0xabc5fb)) {
      return;
    }
    let _0x43ff4b = 0;
    for (const _0x2af7c9 of _0x24b5be) {
      if (!_0x2af7c9.vibeData || _0x2af7c9.vibeData.encodings) {
        continue;
      }
      const _0x134aac = _0x2af7c9.vibeData.name || _0x2af7c9.name;
      for (const _0x161554 of _0xabc5fb) {
        if (!_0x161554.images || !Array.isArray(_0x161554.images)) {
          continue;
        }
        for (const _0x502571 of _0x161554.images) {
          if (!_0x502571.vibeData) {
            continue;
          }
          const _0x3cf26c = _0x502571.vibeData.name || _0x502571.name;
          if (_0x134aac === _0x3cf26c && _0x502571.vibeData.encodings) {
            _0x2af7c9.vibeData.encodings = _0x502571.vibeData.encodings;
            _0x43ff4b++;
            this.ctx.log("image-gen", "已恢复 vibeData.encodings: " + _0x134aac);
            break;
          }
        }
        if (_0x2af7c9.vibeData.encodings) {
          break;
        }
      }
    }
    if (_0x43ff4b > 0) {
      this.ctx.log("image-gen", "共恢复 " + _0x43ff4b + " 个 vibeData.encodings");
    }
  }
  _deepMerge(_0x4d3b95, _0x1f8a54) {
    const _0x160186 = {
      ..._0x4d3b95
    };
    const _0xaee4db = _0x160186;
    for (const _0x4f5109 of Object.keys(_0x1f8a54)) {
      if (_0x1f8a54[_0x4f5109] && typeof _0x1f8a54[_0x4f5109] === "object" && !Array.isArray(_0x1f8a54[_0x4f5109])) {
        _0xaee4db[_0x4f5109] = this._deepMerge(_0xaee4db[_0x4f5109] || {}, _0x1f8a54[_0x4f5109]);
      } else {
        _0xaee4db[_0x4f5109] = _0x1f8a54[_0x4f5109];
      }
    }
    return _0xaee4db;
  }
  _createObserverCallback() {
    return async _0x1ab36b => {
      for (const _0x25cd46 of _0x1ab36b) {
        const _0x10adc7 = _0x25cd46.target;
        const _0x330c77 = _0x10adc7.dataset.imageId;
        if (_0x25cd46.isIntersecting) {
          if (_0x10adc7.dataset.isLoaded !== "true") {
            this.ctx.log("image-gen", "[按需加载] 图片 ID:" + _0x330c77 + " 进入视窗，开始加载");
            const _0x54645a = () => {
              _0x10adc7.style.height = "auto";
              _0x10adc7.style.minHeight = "";
              _0x10adc7.onload = null;
            };
            if (_0x330c77) {
              try {
                const _0x542ede = await this.getCachedImage(parseInt(_0x330c77));
                if (_0x542ede) {
                  const _0x1b5320 = this._zoomRatio || 100;
                  _0x10adc7.style.maxWidth = _0x1b5320 + "%";
                  _0x10adc7.onload = _0x54645a;
                  if (_0x542ede.serverPath) {
                    this.ctx.log("image-gen", "[按需加载] ID:" + _0x330c77 + " 使用 serverPath: " + _0x542ede.serverPath);
                    _0x10adc7.src = _0x542ede.serverPath;
                  } else if (_0x542ede.imageData) {
                    if (_0x10adc7.src.startsWith("blob:")) {
                      this.ctx.log("image-gen", "[按需加载] ID:" + _0x330c77 + " 释放旧 blob: " + _0x10adc7.src);
                      URL.revokeObjectURL(_0x10adc7.src);
                    }
                    if (_0x542ede.imageData instanceof Blob) {
                      const _0x2542f2 = URL.createObjectURL(_0x542ede.imageData);
                      this.ctx.log("image-gen", "[按需加载] ID:" + _0x330c77 + " 从 Blob 创建 URL: " + _0x2542f2);
                      _0x10adc7.src = _0x2542f2;
                    } else {
                      const _0x293e9f = this._dataURLtoBlob(_0x542ede.imageData);
                      if (_0x293e9f) {
                        const _0x46bd96 = URL.createObjectURL(_0x293e9f);
                        this.ctx.log("image-gen", "[按需加载] ID:" + _0x330c77 + " 从 Base64 转换为 Blob URL: " + _0x46bd96);
                        _0x10adc7.src = _0x46bd96;
                      } else {
                        this.ctx.log("image-gen", "[按需加载] ID:" + _0x330c77 + " 使用 Base64 字符串");
                        _0x10adc7.src = _0x542ede.imageData;
                      }
                    }
                  }
                  _0x10adc7.dataset.isLoaded = "true";
                  this.ctx.log("image-gen", "[按需加载] ID:" + _0x330c77 + " 加载完成");
                  if (_0x10adc7.ownerDocument === document && this.interactionManager) {
                    this.interactionManager.addSmartClickHandler(_0x10adc7);
                  }
                }
              } catch (_0x4f3373) {
                this.ctx.error("image-gen", "[按需加载] ID:" + _0x330c77 + " 加载失败", _0x4f3373);
              }
            }
          }
        } else if (_0x10adc7.dataset.isLoaded === "true") {
          this.ctx.log("image-gen", "[按需加载] 图片 ID:" + _0x330c77 + " 离开视窗，开始释放内存");
          const _0x283160 = _0x10adc7.getBoundingClientRect();
          if (_0x283160.height > 0) {
            _0x10adc7.style.height = _0x283160.height + "px";
            _0x10adc7.style.minHeight = _0x283160.height + "px";
            const _0x56c00b = _0x10adc7.src;
            if (_0x56c00b.startsWith("blob:")) {
              this.ctx.log("image-gen", "[按需加载] ID:" + _0x330c77 + " 释放 blob URL: " + _0x56c00b);
              URL.revokeObjectURL(_0x56c00b);
            } else {
              this.ctx.log("image-gen", "[按需加载] ID:" + _0x330c77 + " 清空网络路径 src: " + _0x56c00b);
            }
            _0x10adc7.src = TRANSPARENT_PIXEL;
            _0x10adc7.dataset.isLoaded = "false";
            this.ctx.log("image-gen", "[按需加载] ID:" + _0x330c77 + " 内存释放完成，已替换为占位符");
          }
        }
      }
    };
  }
  _initVisibilityObserver() {
    this._visibilityObserver = new IntersectionObserver(this._createObserverCallback(), {
      rootMargin: "400px 0px 400px 0px"
    });
  }
  _observeImage(_0x5ad727, _0x429046 = true) {
    if (this._visibilityObserver && _0x5ad727) {
      _0x5ad727.dataset.isLoaded = String(_0x429046);
      this._visibilityObserver.observe(_0x5ad727);
    }
  }
  async initMessageObserver() {
    const _0x2a1471 = document.getElementById("chat");
    if (!_0x2a1471) {
      this.ctx.log("image-gen", "未找到聊天容器，延迟初始化观察器");
      setTimeout(() => this.initMessageObserver(), 2000);
      return;
    }
    this._analysisBegins = "image###";
    this._analysisCompleted = "###";
    this._maxButtons = 20;
    this._autoGenerate = true;
    this._maxAutoClicks = 3;
    this._streamingMode = false;
    this._currentStreamProcessedLinks = new Set();
    this._streamingProcessedHashes = new Set();
    this._streamingCount = 0;
    this._autoClickQueue = [];
    this._processedMessages = new WeakSet();
    this._locationToImageIdMap = {};
    this._cacheMapLoaded = false;
    await this._loadScanConfig();
    await this._loadCacheMapping();
    this.ctx.log("image-gen", "缓存映射已加载，共 " + Object.keys(this._locationToImageIdMap).length + " 条");
    this._messageObserver = new MutationObserver(async _0x4042e1 => {
      for (const _0x1c433c of _0x4042e1) {
        if (_0x1c433c.type === "childList") {
          for (const _0xe77567 of _0x1c433c.addedNodes) {
            if (_0xe77567.nodeType === Node.ELEMENT_NODE) {
              const _0x498bd5 = _0xe77567;
              if (_0x498bd5.classList.contains("mes")) {
                await this.injectGenerateButton(_0x498bd5);
              } else if (_0x498bd5.querySelector && _0x498bd5.querySelector(".mes")) {
                const _0x52dc7d = _0x498bd5.querySelectorAll(".mes");
                for (const _0x40b8e8 of _0x52dc7d) {
                  await this.injectGenerateButton(_0x40b8e8);
                }
              }
            }
          }
        }
        if (_0x1c433c.type === "childList" || _0x1c433c.type === "characterData" || _0x1c433c.type === "attributes") {
          const _0x514f42 = _0x1c433c.target;
          if (_0x514f42 instanceof HTMLElement && (_0x514f42.classList.contains("tsp-inline-gen-btn") || _0x514f42.classList.contains("tsp-image-slot") || _0x514f42.closest(".tsp-image-slot") || _0x514f42.classList.contains("tsp-gen-btn"))) {
            return;
          }
          this._debouncedScan();
        }
      }
    });
    this._messageObserver.observe(_0x2a1471, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true
    });
    const _0x5457a6 = _0x2a1471.querySelectorAll(".mes");
    for (const _0x537f3c of _0x5457a6) {
      await this.injectGenerateButton(_0x537f3c);
    }
    this._initStatusObserver();
    this._onSingleMessageUpdateBound = this._handleSingleMessageUpdate.bind(this);
    this._onFullScanBound = () => this._debouncedScan();
    this._usingEventDrivenMode = false;
    if (eventSource && event_types) {
      eventSource.on(event_types.MESSAGE_UPDATED, this._onSingleMessageUpdateBound);
      eventSource.on(event_types.USER_MESSAGE_RENDERED, this._onSingleMessageUpdateBound);
      eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, this._onSingleMessageUpdateBound);
      eventSource.on(event_types.MESSAGE_RECEIVED, this._onSingleMessageUpdateBound);
      eventSource.on(event_types.CHAT_CHANGED, this._onFullScanBound);
      eventSource.on(event_types.CHAT_CREATED, this._onFullScanBound);
      this._usingEventDrivenMode = true;
      this.ctx.log("image-gen", "已注册 SillyTavern 原生事件监听器 (MESSAGE_UPDATED 等)");
    } else {
      console.warn("[TSP] 无法获取 eventSource，回退到定时轮询模式");
      console.log("[TSP] 启动定时扫描器，每2秒执行一次 scanAndInject");
      this._scanInterval = setInterval(() => {
        console.log("[TSP] 定时扫描器执行 scanAndInject");
        this.scanAndInject();
      }, 2000);
    }
    this._debouncedScan();
    this._setupCharacterSwitchListener();
    this.ctx.log("image-gen", "消息观察器与扫描注入已启动");
    setTimeout(() => {
      if (this.storageManager) {
        this.ctx.log("image-gen", "开始检查过期缓存图片...");
        this.storageManager.performRetentionCleanup().catch(_0x18260b => {
          this.ctx.error("image-gen", "自动清理过期缓存失败:", _0x18260b);
        });
      }
    }, 3500);
  }
  _debouncedScan() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this.scanAndInject();
    }, 1500);
  }
  _setupCharacterSwitchListener() {
    const _0xf00597 = window;
    let _0x1ee218 = null;
    const _0x4e0439 = (_0x2a4aeb, _0x5adf1d = 2000) => {
      if ("requestIdleCallback" in window) {
        const _0x4d0fb1 = {
          timeout: _0x5adf1d
        };
        window.requestIdleCallback(_0x2a4aeb, _0x4d0fb1);
      } else {
        setTimeout(_0x2a4aeb, 50);
      }
    };
    const _0x34d24f = () => {
      this.ctx.log("image-gen", "[角色卡切换] 开始清理旧资源");
      this._isCharacterSwitching = true;
      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
      }
      if (this._streamingScanInterval) {
        clearInterval(this._streamingScanInterval);
        this._streamingScanInterval = null;
      }
      if (this._scanInterval) {
        clearInterval(this._scanInterval);
        this._scanInterval = null;
      }
      this._currentStreamProcessedLinks.clear();
      this._streamingProcessedHashes.clear();
      this._streamingCount = 0;
      this._autoClickQueue = [];
      this.ctx.log("image-gen", "[角色卡切换] 旧资源清理完成");
    };
    const _0x45d7a6 = (_0x4408eb = 0) => {
      let _0x33830c = null;
      if (typeof _0xf00597.SillyTavern !== "undefined" && typeof _0xf00597.SillyTavern.getContext === "function") {
        try {
          const _0x368673 = _0xf00597.SillyTavern.getContext();
          _0x33830c = _0x368673?.eventSource;
        } catch (_0x29d579) {}
      }
      if (!_0x33830c) {
        _0x33830c = _0xf00597.eventSource;
      }
      if (!_0x33830c) {
        if (_0x4408eb < 20) {
          setTimeout(() => _0x45d7a6(_0x4408eb + 1), 1000);
        }
        return;
      }
      _0x33830c.on("chatLoaded", async _0x4560c0 => {
        if (_0x1ee218) {
          clearTimeout(_0x1ee218);
        }
        _0x34d24f();
        const _0x483edb = _0x4560c0?.detail || _0x4560c0;
        const _0x562c79 = _0x483edb?.character?.name || _0x483edb?.character;
        _0x1ee218 = setTimeout(async () => {
          let _0x325cf5 = this.storageManager?._getCurrentCharacterName();
          if (!_0x325cf5 && _0x562c79) {
            _0x325cf5 = this.storageManager?._sanitizeCharacterName(_0x562c79);
          }
          if (!_0x325cf5) {
            this._isCharacterSwitching = false;
            return;
          }
          _0x4e0439(async () => {
            this.ctx.log("image-gen", "[优化加载] 开始加载角色卡缓存: " + _0x325cf5);
            this._locationToImageIdMap = {};
            this._cacheMapLoaded = false;
            this._clearProcessedFlags();
            await this._loadCacheMapping();
            const _0x530e85 = Object.keys(this._locationToImageIdMap).length;
            this.ctx.log("image-gen", "[优化加载] 数据库读取完成，共 " + _0x530e85 + " 张图片");
            _0x4e0439(async () => {
              this._isSyncingUI = true;
              if (this._fixHashlineEnabled) {
                await this._fixHashlineInLastMessage();
              }
              this._updateExistingButtonsWithCache();
              this.scanAndInject();
              this._isCharacterSwitching = false;
              this.ctx.log("image-gen", "[角色卡切换] 缓存加载完成，自动点击功能已恢复");
              setTimeout(() => {
                if (_0x530e85 > 0) {
                  this.ctx.helpers.showToast("✨ 已加载 " + _0x530e85 + " 张图片缓存", "success");
                } else {
                  this.ctx.log("image-gen", "当前角色卡没有缓存图片，跳过 Toast 提示");
                }
              }, 0);
              setTimeout(() => {
                _0x4e0439(() => {
                  this._updateExistingButtonsWithCache();
                  this._clearIframeProcessedFlags();
                  this.scanAndInject();
                  this.ctx.log("image-gen", "[优化加载] 最终补充扫描完成");
                }, 1000);
              }, 3000);
              if (!this._usingEventDrivenMode && !this._scanInterval) {
                console.log("[TSP] 重新启动定时扫描器，每2秒执行一次 scanAndInject");
                this._scanInterval = setInterval(() => {
                  console.log("[TSP] 定时扫描器执行 scanAndInject");
                  this.scanAndInject();
                }, 2000);
                this.ctx.log("image-gen", "[优化加载] 重新启动定时扫描器");
              } else if (this._usingEventDrivenMode) {
                console.log("[TSP] 使用事件驱动模式，跳过定时扫描器启动");
              }
              setTimeout(() => {
                this._isSyncingUI = false;
                this.ctx.log("image-gen", "[角色卡切换] UI 同步完成，自动点击功能已恢复");
              }, 4000);
            }, 1000);
          }, 5000);
        }, 2500);
      });
      this.ctx.log("image-gen", "角色卡切换监听器已设置 (防抖+性能优化+统计版)");
    };
    _0x45d7a6();
  }
  _clearProcessedFlags() {
    const _0x389e43 = document.getElementById("chat");
    if (_0x389e43) {
      _0x389e43.querySelectorAll(".mes_text").forEach(_0x330d32 => {
        const _0x59d430 = _0x330d32;
        delete _0x59d430.dataset.tspProcessed;
        delete _0x59d430.dataset.tspIframeProcessed;
      });
      _0x389e43.querySelectorAll(".tsp-inline-gen-btn").forEach(_0x274db0 => {
        const _0x4a4260 = _0x274db0;
        delete _0x4a4260.dataset.bound;
      });
      _0x389e43.querySelectorAll(".tsp-generated-image, .tsp-inline-image").forEach(_0x1cd5b9 => {
        const _0x11f456 = _0x1cd5b9;
        _0x11f456.dataset.isLoaded = "false";
        this._observeImage(_0x11f456, false);
      });
    }
    const _0x3c10fb = document.querySelectorAll("iframe");
    for (const _0x108b8b of _0x3c10fb) {
      try {
        const _0x496a2e = _0x108b8b.contentDocument || _0x108b8b.contentWindow?.document;
        if (_0x496a2e) {
          delete _0x108b8b.dataset.tspProcessed;
          delete _0x108b8b.dataset.tspContentHash;
          _0x496a2e.querySelectorAll(".tsp-inline-gen-btn").forEach(_0x3754a2 => {
            const _0x6f17ba = _0x3754a2;
            delete _0x6f17ba.dataset.bound;
          });
          _0x496a2e.querySelectorAll(".tsp-generated-image, .tsp-inline-image").forEach(_0x3615d1 => {
            const _0xf06307 = _0x3615d1;
            _0xf06307.dataset.isLoaded = "false";
            this._observeImage(_0xf06307, false);
          });
        }
      } catch (_0x1fd8df) {}
    }
  }
  _updateExistingButtonsWithCache() {
    const _0x471db0 = document.getElementById("chat");
    if (!_0x471db0) {
      return;
    }
    this.ctx.log("image-gen", "正在同步 UI... 内存映射数: " + Object.keys(this._locationToImageIdMap).length);
    const _0x13e0bb = _0x471db0.querySelectorAll(".tsp-inline-gen-btn:not(.tsp-regenerate-btn)");
    let _0x2d30f7 = 0;
    _0x13e0bb.forEach(_0x40d593 => {
      const _0x503fad = _0x40d593.dataset.locationHash;
      if (!_0x503fad) {
        return;
      }
      const _0x3add1f = this._locationToImageIdMap[_0x503fad];
      if (_0x3add1f && _0x3add1f !== "processing") {
        this._refreshMessageButtons(_0x503fad, _0x3add1f);
        _0x2d30f7++;
      }
    });
    if (_0x2d30f7 > 0) {
      this.ctx.log("image-gen", "同步完成：已将 " + _0x2d30f7 + " 个按钮转换为图片槽");
    }
  }
  _clearIframeProcessedFlags() {
    const _0x4a2e1e = document.getElementById("chat");
    if (_0x4a2e1e) {
      _0x4a2e1e.querySelectorAll(".mes_text").forEach(_0x1f49c1 => {
        const _0x514f87 = _0x1f49c1;
        delete _0x514f87.dataset.tspIframeProcessed;
      });
    }
    const _0x4a0bb6 = document.querySelectorAll("iframe");
    for (const _0x5bc151 of _0x4a0bb6) {
      try {
        const _0x129910 = _0x5bc151.contentDocument || _0x5bc151.contentWindow?.document;
        if (_0x129910) {
          delete _0x5bc151.dataset.tspProcessed;
          delete _0x5bc151.dataset.tspContentHash;
          _0x129910.querySelectorAll(".log-entry").forEach(_0x5c3c7d => {
            const _0x2756ee = _0x5c3c7d;
            delete _0x2756ee.dataset.tspLogProcessed;
            delete _0x2756ee.dataset.tspContentHash;
          });
          _0x129910.querySelectorAll(".tsp-inline-gen-btn").forEach(_0x5c1b46 => {
            const _0x568245 = _0x5c1b46;
            delete _0x568245.dataset.bound;
          });
        }
      } catch (_0x11ffbf) {}
    }
  }
  _initStatusObserver() {
    const _0x2e845f = document.getElementById("mes_stop");
    if (!_0x2e845f) {
      setTimeout(() => this._initStatusObserver(), 1000);
      return;
    }
    this.ctx.log("image-gen", "初始化生成状态观察器 (监听 mes_stop)");
    const _0x389bda = window.getComputedStyle(_0x2e845f);
    this.isAiGenerating = _0x389bda.display !== "none";
    this._statusObserver = new MutationObserver(_0x32dfe2 => {
      for (const _0x109bd5 of _0x32dfe2) {
        if (_0x109bd5.type === "attributes" && _0x109bd5.attributeName === "style") {
          const _0x3605af = _0x2e845f.style.display !== "none";
          if (_0x3605af && !this.isAiGenerating) {
            this.isAiGenerating = true;
            this.ctx.log("image-gen", "检测到 AI 开始生成，启动流式扫描");
            this._currentStreamProcessedLinks.clear();
            this._streamingProcessedHashes.clear();
            this._streamingCount = 0;
            if (this._streamingMode && this._autoGenerate) {
              if (!this._streamingScanInterval) {
                this._performStreamingScan();
                this._streamingScanInterval = setInterval(() => {
                  this._performStreamingScan();
                }, 1000);
              }
            }
          } else if (!_0x3605af && this.isAiGenerating) {
            this.isAiGenerating = false;
            this.ctx.log("image-gen", "检测到 AI 生成结束，停止流式扫描");
            if (this._streamingScanInterval) {
              clearInterval(this._streamingScanInterval);
              this._streamingScanInterval = null;
            }
            const _0x3ecd1e = this.ctx.getModule("aiProcessor");
            if (_0x3ecd1e && _0x3ecd1e.isBatchingEnabled()) {
              setTimeout(() => {
                _0x3ecd1e.flushBatchQueue();
              }, 2500);
            }
            if (window.requestIdleCallback) {
              window.requestIdleCallback(() => this.scanAndInject());
            } else {
              setTimeout(() => this.scanAndInject(), 200);
            }
          }
        }
      }
    });
    this._statusObserver.observe(_0x2e845f, {
      attributes: true,
      attributeFilter: ["style"]
    });
  }
  async _loadCacheMapping() {
    try {
      let _0xbcda98 = this.storageManager?._getCurrentCharacterName();
      if (!_0xbcda98 && this.storageManager?.getStorageMode() === "tavern") {
        _0xbcda98 = "SillyTavern_System";
      }
      this.ctx.log("image-gen", "_loadCacheMapping: 同步目标角色=\"" + (_0xbcda98 || "无") + "\"");
      let _0x32da25 = await this.ctx.db.getImageCacheLight();
      let _0x34d6b3 = [];
      let _0x7da5d5 = new Map();
      const _0x1522a0 = this.storageManager && this.storageManager.getStorageMode() === "tavern";
      if (_0xbcda98 && _0x1522a0) {
        try {
          this.storageManager._loadedCharacters.delete(_0xbcda98);
          _0x34d6b3 = await this.storageManager.loadCharacterMetadata(_0xbcda98);
          for (const _0x139f91 of _0x34d6b3) {
            _0x7da5d5.set(_0x139f91.id, _0x139f91);
          }
          this.ctx.log("image-gen", "[同步] 服务器配置文件包含 " + _0x34d6b3.length + " 条记录");
          const _0x4fde64 = await this.ctx.db.getAllLight(StoreNames.IMAGE_CACHE, ["imageData", "maskData", "thumbnailData"]);
          const _0x5ea253 = _0x4fde64.filter(_0x1122c4 => _0x1122c4.characterName === _0xbcda98);
          for (const _0x2bf097 of _0x5ea253) {
            const _0x2f2451 = _0x7da5d5.get(_0x2bf097.id);
            if (!_0x2f2451) {
              const _0x2b82e0 = await this.ctx.db.get(StoreNames.IMAGE_CACHE, _0x2bf097.id);
              const _0x6a5dac = _0x2b82e0 && (_0x2b82e0.imageData instanceof Blob || typeof _0x2b82e0.imageData === "string" && _0x2b82e0.imageData.length > 500);
              if (_0x6a5dac) {} else {
                this.ctx.log("image-gen", "[清理] 发现幽灵数据 ID " + _0x2bf097.id + " (本地无图且服务器无记录)，正在删除...");
                await this.ctx.db.delete(StoreNames.IMAGE_CACHE, _0x2bf097.id);
                _0x32da25 = _0x32da25.filter(_0x31f4b4 => _0x31f4b4.id !== _0x2bf097.id);
              }
            } else if (_0x2f2451.serverPath !== _0x2bf097.serverPath || _0x2f2451.thumbnailPath !== _0x2bf097.thumbnailPath) {
              this.ctx.log("image-gen", "[更新] 同步路径 ID " + _0x2bf097.id + ": " + _0x2bf097.serverPath + " -> " + _0x2f2451.serverPath);
              const _0x265801 = await this.ctx.db.get(StoreNames.IMAGE_CACHE, _0x2bf097.id);
              if (_0x265801) {
                _0x265801.serverPath = _0x2f2451.serverPath;
                _0x265801.thumbnailPath = _0x2f2451.thumbnailPath;
                _0x265801.timestamp = _0x2f2451.timestamp || _0x265801.timestamp;
                _0x265801.originalPrompt = _0x2f2451.originalPrompt || _0x265801.originalPrompt || "";
                _0x265801.editedPrompt = _0x2f2451.editedPrompt !== undefined ? _0x2f2451.editedPrompt : _0x265801.editedPrompt || null;
                await this.ctx.db.put(StoreNames.IMAGE_CACHE, _0x265801);
              }
            }
          }
        } catch (_0xab90a7) {
          this.ctx.warn("image-gen", "同步服务器元数据失败:", _0xab90a7);
        }
      }
      const _0x3ad2e4 = new Map();
      for (const _0x71f94e of _0x32da25) {
        _0x3ad2e4.set(_0x71f94e.id, _0x71f94e);
      }
      let _0x444a53 = 0;
      if (_0xbcda98 && _0x1522a0) {
        for (const _0x26c172 of _0x34d6b3) {
          if (!_0x3ad2e4.has(_0x26c172.id)) {
            const _0x14aaa7 = {
              id: _0x26c172.id,
              locationHash: _0x26c172.locationHash,
              serverPath: _0x26c172.serverPath,
              thumbnailPath: _0x26c172.thumbnailPath,
              timestamp: _0x26c172.timestamp,
              characterName: _0x26c172.characterName || _0xbcda98,
              time: _0x26c172.time,
              mode: _0x26c172.mode,
              originalPrompt: _0x26c172.originalPrompt || "",
              editedPrompt: _0x26c172.editedPrompt || null
            };
            const _0x23a6a5 = _0x14aaa7;
            await this.ctx.db.put(StoreNames.IMAGE_CACHE, _0x23a6a5);
            _0x3ad2e4.set(_0x23a6a5.id, _0x23a6a5);
            _0x32da25.push(_0x23a6a5);
            _0x444a53++;
          }
        }
      }
      if (_0x444a53 > 0) {
        this.ctx.log("image-gen", "从服务器补充了 " + _0x444a53 + " 条新记录");
      }
      this._locationToImageIdMap = {};
      let _0x4e9b52 = 0;
      for (const _0x1c7af8 of _0x32da25) {
        if (_0x1c7af8.id !== undefined && _0x1c7af8.id !== null) {
          if (_0x1c7af8.locationHash && _0x1c7af8.locationHash.length > 0) {
            this._locationToImageIdMap[_0x1c7af8.locationHash] = _0x1c7af8.id;
            _0x4e9b52++;
          }
        }
      }
      this.ctx.log("image-gen", "缓存映射构建完成 (Total: " + _0x4e9b52 + ", 仅含 id+hash)");
      this._cacheMapLoaded = true;
    } catch (_0x2e3889) {
      this.ctx.error("image-gen", "加载缓存映射失败:", _0x2e3889);
      this._cacheMapLoaded = true;
    }
  }
  updateCacheMapping(_0x4876c6, _0x180955) {
    if (!_0x4876c6 || !_0x180955) {
      return;
    }
    this._locationToImageIdMap[_0x4876c6] = parseInt(_0x180955);
    this.ctx.log("image-gen", "手动更新缓存映射: hash=" + _0x4876c6.substring(0, 8) + "... -> id=" + _0x180955);
    this._refreshMessageButtons(_0x4876c6, _0x180955);
  }
  async _loadScanConfig() {
    try {
      this._analysisBegins = await this.ctx.api.getValue("chami_analysis_begins", "image###");
      this._analysisCompleted = await this.ctx.api.getValue("chami_analysis_completed", "###");
      this._maxButtons = await this.ctx.api.getValue("chami_max_button", 20);
      this._autoGenerate = await this.ctx.api.getValue("auto_generate_click", true);
      this._maxAutoClicks = await this.ctx.api.getValue("max_auto_clicks", 3);
      this._zoomRatio = await this.ctx.api.getValue("chami_image_zoom_ratio", 100);
      this._streamingMode = await this.ctx.api.getValue("chami_streaming_mode", false);
      this._privacyMode = await this.ctx.api.getValue("chami_privacy_mode", false);
      this._fixHashlineEnabled = await this.ctx.api.getValue("fix_hashline_enabled", false);
      const _0x408d4e = await this.ctx.api.getValue("multichar_config", null);
      if (_0x408d4e && typeof MultiCharacterParser !== "undefined") {
        MultiCharacterParser.setConfig(_0x408d4e);
        this.ctx.log("image-gen", "已加载多角色定义配置:", _0x408d4e);
      }
    } catch (_0x43720d) {
      this.ctx.error("image-gen", "加载扫描配置失败:", _0x43720d);
    }
    if (!this._analysisBegins) {
      this._analysisBegins = "image###";
    }
    if (!this._analysisCompleted) {
      this._analysisCompleted = "###";
    }
  }
  setZoomRatio(_0x165c80) {
    this._zoomRatio = _0x165c80;
    const _0x13b6b4 = _0x165c80 + "%";
    const _0xdf2e94 = _0x5e3efd => {
      const _0x47cfbb = _0x5e3efd.querySelectorAll(".tsp-privacy-container");
      _0x47cfbb.forEach(_0xb2642b => {
        _0xb2642b.style.maxWidth = _0x13b6b4;
      });
      const _0x5e21ee = _0x5e3efd.querySelectorAll(".tsp-generated-image, .tsp-inline-image");
      _0x5e21ee.forEach(_0x141609 => {
        if (_0x141609.closest(".tsp-privacy-container")) {
          _0x141609.style.maxWidth = "100%";
        } else {
          _0x141609.style.maxWidth = _0x13b6b4;
        }
      });
    };
    _0xdf2e94(document);
    const _0x25b458 = document.querySelectorAll("iframe");
    _0x25b458.forEach(_0x332328 => {
      try {
        const _0x361919 = _0x332328.contentDocument || _0x332328.contentWindow?.document;
        if (_0x361919) {
          _0xdf2e94(_0x361919);
        }
      } catch (_0x192bdd) {}
    });
  }
  async _fixHashlineInLastMessage() {
    this.ctx.log("image-gen", "[Hashline修复] _fixHashlineInLastMessage 开始执行");
    if (!chat || chat.length === 0) {
      this.ctx.log("image-gen", "[Hashline修复] chat 为空或没有消息");
      return;
    }
    const _0x458ad9 = chat.length - 1;
    this.ctx.log("image-gen", "[Hashline修复] 最后一个消息索引: " + _0x458ad9);
    await this._fixHashlineInMessageContent(_0x458ad9);
  }
  async _fixHashlineInMessageContent(_0x40463e) {
    this.ctx.log("image-gen", "[Hashline修复] _fixHashlineInMessageContent 开始执行, mesId=" + _0x40463e + ", _fixHashlineEnabled=" + this._fixHashlineEnabled);
    if (!this._fixHashlineEnabled) {
      this.ctx.log("image-gen", "[Hashline修复] _fixHashlineEnabled 为 false，跳过");
      return false;
    }
    if (!chat || !chat[_0x40463e]) {
      this.ctx.log("image-gen", "[Hashline修复] chat 或 chat[mesId] 不存在");
      return false;
    }
    const _0x18a29 = chat[_0x40463e].mes || "";
    const _0x40eaf6 = _0x18a29.includes(this._analysisBegins);
    const _0x25fa5e = _0x18a29.includes(this._analysisCompleted);
    if (!_0x40eaf6 || !_0x25fa5e) {
      return false;
    }
    const _0xde6c4b = this._analysisBegins;
    const _0x5ef35e = this._analysisCompleted;
    const _0x900129 = _0x18a29.indexOf(_0xde6c4b);
    const _0x57d121 = _0x18a29.lastIndexOf(_0x5ef35e);
    if (_0x900129 === -1 || _0x57d121 === -1 || _0x900129 >= _0x57d121) {
      return false;
    }
    let _0x4ff3b0 = false;
    let _0x150cbb = _0x18a29;
    const _0x443aa4 = _0x18a29.substring(0, _0x900129);
    const _0x28e379 = _0x18a29.substring(_0x900129, _0x57d121 + _0x5ef35e.length);
    const _0x9a0c3e = _0x18a29.substring(_0x57d121 + _0x5ef35e.length);
    const _0x181d56 = this._mergeStandaloneHashlines(_0x28e379);
    if (_0x181d56 !== _0x28e379) {
      _0x150cbb = _0x443aa4 + _0x181d56 + _0x9a0c3e;
      _0x4ff3b0 = true;
      this.ctx.log("image-gen", "[Hashline修复] middleRegion 内容经过重组修复");
    }
    if (!_0x4ff3b0) {
      this.ctx.log("image-gen", "[Hashline修复] 没有内容发生了变动，跳过保存");
      return false;
    }
    this.ctx.log("image-gen", "[Hashline修复] 执行修复与UI状态刷新");
    chat[_0x40463e].mes = _0x150cbb;
    if (chat[_0x40463e].extra && chat[_0x40463e].extra.display_text) {
      delete chat[_0x40463e].extra.display_text;
    }
    updateMessageBlock(_0x40463e, chat[_0x40463e]);
    if (eventSource && event_types) {
      await eventSource.emit(event_types.MESSAGE_UPDATED, _0x40463e);
    }
    await saveChatConditional();
    this.ctx.log("image-gen", "[Hashline修复] 已彻底修复并渲染楼层 #" + _0x40463e + " 中的独立 ### 换行问题");
    return true;
  }
  _mergeStandaloneHashlines(_0x1df788) {
    this.ctx.log("image-gen", "[Hashline修复] _mergeStandaloneHashlines 输入: " + _0x1df788.substring(0, 300) + "...");
    const _0x7f279 = _0x1df788.split("\n");
    const _0x12cb2f = [];
    let _0x579dd7 = false;
    for (let _0x46af42 = 0; _0x46af42 < _0x7f279.length; _0x46af42++) {
      const _0x35204b = _0x7f279[_0x46af42];
      const _0x1181d3 = _0x35204b.trim();
      if (_0x1181d3 === "###" || _0x1181d3 === "##" || _0x1181d3 === "#") {
        if (_0x12cb2f.length > 0) {
          _0x12cb2f[_0x12cb2f.length - 1] += _0x1181d3;
          _0x579dd7 = true;
          this.ctx.log("image-gen", "[Hashline修复] 已消除独立行的换行: 将 " + _0x1181d3 + " 合并至上一行");
          continue;
        }
      }
      _0x12cb2f.push(_0x35204b);
    }
    const _0x4a8df0 = _0x579dd7 ? _0x12cb2f.join("\n") : _0x1df788;
    this.ctx.log("image-gen", "[Hashline修复] _mergeStandaloneHashlines 输出" + (_0x579dd7 ? "(已修改)" : "(未修改)") + ": " + _0x4a8df0.substring(0, 300) + "...");
    return _0x4a8df0;
  }
  async scanAndInject() {
    console.log("[TSP] scanAndInject 函数执行开始");
    if (this._fixHashlineEnabled && chat && chat.length > 0) {
      await this._fixHashlineInLastMessage();
    }
    const _0x5f5271 = await this.ctx.api.getValue("text2img_enabled", true);
    if (!_0x5f5271) {
      this.ctx.log("image-gen", "[文生图关闭] 清理相关资源");
      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
      }
      if (this._streamingScanInterval) {
        clearInterval(this._streamingScanInterval);
        this._streamingScanInterval = null;
      }
      this._currentStreamProcessedLinks.clear();
      this._streamingProcessedHashes.clear();
      this._streamingCount = 0;
      return;
    }
    const _0x340b0d = await this.ctx.api.getValue("inject_buttons_enabled", true);
    if (!_0x340b0d) {
      const _0x1c5670 = document.getElementById("chat");
      if (_0x1c5670) {
        const _0x6f86a1 = _0x1c5670.querySelectorAll(".tsp-gen-container");
        _0x6f86a1.forEach(_0x8c0a2 => _0x8c0a2.remove());
      }
    }
    if (this.isAiGenerating) {
      if (this._autoGenerate && this._streamingMode) {
        this._performStreamingScan();
      }
      return;
    }
    const _0x128662 = document.getElementById("chat");
    if (!_0x128662) {
      return;
    }
    if (!this._cacheMapLoaded) {
      return;
    }
    const _0x110824 = _0x128662.querySelectorAll(".mes");
    const _0x321e7e = [];
    const _0x57b17c = Array.from(_0x110824);
    const _0x20453c = _0x57b17c.slice(-this._maxButtons);
    _0x20453c.reverse().forEach(_0x4f7510 => {
      const _0x442bb1 = _0x4f7510;
      const _0x290be8 = this.scanAndInjectMessage(_0x442bb1);
      if (_0x290be8.length > 0 && this._autoGenerate) {
        _0x321e7e.push(..._0x290be8);
      }
    });
    this.scanPhoneChatWindow();
    if (_0x321e7e.length > 0) {
      this.processAutoClickQueue(_0x321e7e);
    }
  }
  _limitPhoneChatMessages() {
    const _0x40eaf4 = document.getElementById("tsp-phone-chat-messages");
    if (!_0x40eaf4) {
      return;
    }
    try {
      const _0x5beaef = localStorage.getItem("tsp-plugin-phone-config");
      const _0x4630ed = _0x5beaef ? JSON.parse(_0x5beaef) : {
        messageLimit: 30
      };
      const _0x3b12cc = _0x4630ed.messageLimit || 30;
      const _0x15d2c6 = _0x40eaf4.querySelectorAll(".tsp-phone-message");
      const _0x321437 = _0x15d2c6.length;
      if (_0x321437 > _0x3b12cc) {
        const _0x559092 = _0x321437 - _0x3b12cc;
        for (let _0x5bf879 = 0; _0x5bf879 < _0x559092; _0x5bf879++) {
          if (_0x15d2c6[_0x5bf879]) {
            _0x15d2c6[_0x5bf879].remove();
          }
        }
        this.ctx.log("image-gen", "[手机聊天] 已移除 " + _0x559092 + " 条旧消息，保持 " + _0x3b12cc + " 条显示");
      }
    } catch (_0x127f87) {
      this.ctx.error("image-gen", "限制消息数量失败:", _0x127f87);
    }
  }
  scanPhoneChatWindow() {
    const _0x45a237 = document.getElementById("tsp-phone-chat-messages");
    if (!_0x45a237) {
      return;
    }
    const _0x451d5c = _0x45a237.querySelectorAll(".tsp-phone-message");
    if (_0x451d5c.length === 0) {
      return;
    }
    _0x451d5c.forEach(_0x1e4421 => {
      const _0x42e380 = _0x1e4421.querySelector(".tsp-phone-message-content");
      if (!_0x42e380) {
        return;
      }
      const _0x1b0463 = _0x42e380.innerHTML || "";
      const _0x57f737 = _0x1b0463.includes(this._analysisBegins);
      if (!_0x57f737 && _0x42e380.dataset.tspProcessed === "true") {
        return;
      }
      if (_0x57f737) {
        delete _0x42e380.dataset.tspProcessed;
      }
      const _0x106680 = this._escapeRegex(this._analysisBegins);
      const _0x3f15d4 = this._escapeRegex(this._analysisCompleted);
      const _0x8fa565 = new RegExp(_0x106680 + "([\\s\\S]*?)" + _0x3f15d4, "g");
      const _0x5a8601 = [..._0x1b0463.matchAll(_0x8fa565)];
      if (_0x5a8601.length === 0) {
        return;
      }
      const _0x53acec = _0x1e4421.dataset.msgId;
      const _0x8457ce = _0x1e4421.dataset.timestamp;
      if (!_0x53acec || !_0x8457ce) {
        this.ctx.log("image-gen", "[手机聊天] 消息缺少必要的标识属性，跳过处理", _0x1e4421);
        return;
      }
      const _0x2d52ca = [];
      let _0x57faec = 0;
      let _0x2578d9 = _0x1b0463;
      this.ctx.log("image-gen", "[手机聊天] 开始处理消息 - msgId: " + _0x53acec + ", timestamp: " + _0x8457ce);
      for (const _0x648c66 of _0x5a8601) {
        const _0x305ac9 = _0x648c66[0];
        const _0x47aba5 = _0x648c66[1].trim();
        const _0x4b8dcf = this._createStableLinkContent(_0x47aba5);
        const _0xa48942 = this._md5(_0x53acec + "-" + _0x4b8dcf + "-" + _0x57faec);
        this.ctx.log("image-gen", "[手机聊天] 哈希计算 - msgId: " + _0x53acec + ", link: " + _0x4b8dcf + ", matchIndex: " + _0x57faec + " => locationHash: " + _0xa48942);
        const _0x5d7b72 = this._locationToImageIdMap[_0xa48942];
        const _0x478175 = _0x5d7b72 === "processing";
        this.ctx.log("image-gen", "[手机聊天] 缓存查找 - locationHash: " + _0xa48942 + ", cachedImageId: " + _0x5d7b72 + ", isProcessing: " + _0x478175);
        let _0x411ae2;
        if (_0x5d7b72 && _0x5d7b72 !== "processing") {
          _0x411ae2 = "<span class=\"tsp-image-slot\" data-location-hash=\"" + _0xa48942 + "\" data-image-id=\"" + _0x5d7b72 + "\">\n                        <button class=\"tsp-inline-gen-btn tsp-regenerate-btn\"\n                                data-link=\"" + this._escapeHtml(_0x4b8dcf) + "\"\n                                data-location-hash=\"" + _0xa48942 + "\"\n                                data-match-index=\"" + _0x57faec + "\"\n                                title=\"重新生成图片\">\n                            生成图片\n                        </button>\n                        <img class=\"tsp-generated-image tsp-inline-image\"\n                             src=\"" + TRANSPARENT_PIXEL + "\"\n                             data-is-loaded=\"false\"\n                             data-image-id=\"" + _0x5d7b72 + "\"\n                             data-location-hash=\"" + _0xa48942 + "\"\n                             alt=\"图片占位符\"\n                             style=\"max-width:200px; max-height:200px; cursor:pointer; border-radius:8px; min-height: 50px; background: rgba(122,162,247,0.1);\">\n                    </span>";
        } else if (_0x478175) {
          _0x411ae2 = "<button class=\"tsp-inline-gen-btn\"\n                            data-link=\"" + this._escapeHtml(_0x4b8dcf) + "\"\n                            data-location-hash=\"" + _0xa48942 + "\"\n                            data-match-index=\"" + _0x57faec + "\"\n                            disabled=\"true\">\n                        <i class=\"fa-solid fa-spinner fa-spin\"></i> ⏳ 处理中...\n                    </button>";
        } else {
          _0x411ae2 = "<button class=\"tsp-inline-gen-btn\" data-link=\"" + this._escapeHtml(_0x4b8dcf) + "\" data-location-hash=\"" + _0xa48942 + "\" data-match-index=\"" + _0x57faec + "\" title=\"点击生成图片\">\n                        <i class=\"fa-solid fa-image\"></i> 生成图片\n                    </button>";
        }
        _0x2578d9 = _0x2578d9.replace(_0x305ac9, _0x411ae2);
        _0x57faec++;
      }
      if (_0x2578d9 !== _0x1b0463) {
        _0x42e380.innerHTML = _0x2578d9;
        _0x42e380.dataset.tspProcessed = "true";
        addCopyToCodeBlocks(_0x42e380);
        const _0x4d155b = _0x42e380.querySelectorAll(".tsp-inline-gen-btn");
        _0x4d155b.forEach(_0x306e96 => {
          const _0x3bdc50 = _0x306e96;
          if (!_0x3bdc50.dataset.bound) {
            _0x3bdc50.dataset.bound = "true";
            _0x3bdc50.addEventListener("click", _0x2273bb => this._handleInlineButtonClick(_0x2273bb, _0x3bdc50, _0x1e4421));
            _0x2d52ca.push(_0x3bdc50);
          }
        });
        const _0x491ba5 = _0x42e380.querySelectorAll("img.tsp-inline-image[data-is-loaded=\"false\"]");
        if (_0x491ba5.length > 0) {
          requestAnimationFrame(async () => {
            for (const _0x38e552 of _0x491ba5) {
              const _0x4ae556 = _0x38e552;
              const _0x6f5772 = _0x4ae556.dataset.imageId;
              if (!_0x6f5772) {
                continue;
              }
              this.ctx.log("image-gen", "[手机聊天] 直接加载图片 ID:" + _0x6f5772 + "（不使用懒加载）");
              const _0xfcff89 = () => {
                _0x4ae556.style.height = "auto";
                _0x4ae556.style.minHeight = "";
                _0x4ae556.onload = null;
              };
              try {
                const _0x353dbb = await this.getCachedImage(parseInt(_0x6f5772));
                if (_0x353dbb) {
                  const _0xce2bac = this._zoomRatio || 100;
                  _0x4ae556.style.maxWidth = _0xce2bac + "%";
                  _0x4ae556.onload = _0xfcff89;
                  if (_0x353dbb.serverPath) {
                    this.ctx.log("image-gen", "[手机聊天] ID:" + _0x6f5772 + " 使用 serverPath: " + _0x353dbb.serverPath);
                    _0x4ae556.src = _0x353dbb.serverPath;
                  } else if (_0x353dbb.imageData) {
                    if (_0x4ae556.src.startsWith("blob:")) {
                      URL.revokeObjectURL(_0x4ae556.src);
                    }
                    if (_0x353dbb.imageData instanceof Blob) {
                      const _0x4b8517 = URL.createObjectURL(_0x353dbb.imageData);
                      this.ctx.log("image-gen", "[手机聊天] ID:" + _0x6f5772 + " 从 Blob 创建 URL: " + _0x4b8517);
                      _0x4ae556.src = _0x4b8517;
                    } else {
                      const _0x47519a = this._dataURLtoBlob(_0x353dbb.imageData);
                      if (_0x47519a) {
                        const _0x13bce3 = URL.createObjectURL(_0x47519a);
                        this.ctx.log("image-gen", "[手机聊天] ID:" + _0x6f5772 + " 从 Base64 转换为 Blob URL: " + _0x13bce3);
                        _0x4ae556.src = _0x13bce3;
                      } else {
                        this.ctx.log("image-gen", "[手机聊天] ID:" + _0x6f5772 + " 使用 Base64 字符串");
                        _0x4ae556.src = _0x353dbb.imageData;
                      }
                    }
                  }
                  _0x4ae556.dataset.isLoaded = "true";
                  this.ctx.log("image-gen", "[手机聊天] ID:" + _0x6f5772 + " 加载完成");
                  if (_0x4ae556.ownerDocument === document && this.interactionManager) {
                    this.interactionManager.addSmartClickHandler(_0x4ae556);
                  }
                }
              } catch (_0x3da1ce) {
                this.ctx.error("image-gen", "[手机聊天] ID:" + _0x6f5772 + " 加载失败", _0x3da1ce);
              }
            }
          });
        }
      }
    });
  }
  scanPhoneMoments() {
    const _0x3c5d58 = document.getElementById("tsp-phone-moments-content");
    if (!_0x3c5d58) {
      return;
    }
    const _0x20b1de = _0x3c5d58.querySelectorAll(".tsp-phone-post-card");
    if (_0x20b1de.length === 0) {
      return;
    }
    this.ctx.log("image-gen", "[朋友圈] 开始扫描 " + _0x20b1de.length + " 条朋友圈");
    _0x20b1de.forEach((_0x3dd982, _0x35ca1b) => {
      const _0x482ada = _0x3dd982.querySelector(".tsp-phone-post-image");
      if (!_0x482ada) {
        return;
      }
      const _0x17f87e = _0x482ada.querySelector(".tsp-phone-image-caption");
      if (!_0x17f87e) {
        return;
      }
      const _0x1bce97 = _0x17f87e.textContent || _0x17f87e.innerHTML || "";
      const _0x1c3971 = _0x1bce97.includes("image###");
      if (!_0x1c3971 && _0x482ada.dataset.tspProcessed === "true") {
        return;
      }
      if (_0x1c3971) {
        delete _0x482ada.dataset.tspProcessed;
      }
      const _0x497361 = /image###([\s\S]*?)###/g;
      const _0x21b320 = [..._0x1bce97.matchAll(_0x497361)];
      if (_0x21b320.length === 0) {
        return;
      }
      const _0x3e51e3 = _0x3dd982.dataset.momentId || "moment_" + _0x35ca1b;
      this.ctx.log("image-gen", "[朋友圈] 处理朋友圈 - momentId: " + _0x3e51e3);
      let _0x113bfb = 0;
      let _0x35596c = _0x1bce97;
      for (const _0x4af18f of _0x21b320) {
        const _0xb5514 = _0x4af18f[0];
        const _0x5d323f = _0x4af18f[1].trim();
        const _0x1f33ed = this._createStableLinkContent(_0x5d323f);
        const _0x3f24f3 = this._md5(_0x3e51e3 + "-" + _0x1f33ed + "-" + _0x113bfb);
        this.ctx.log("image-gen", "[朋友圈] 哈希计算 - momentId: " + _0x3e51e3 + ", link: " + _0x1f33ed.substring(0, 30) + "..., locationHash: " + _0x3f24f3.substring(0, 8) + "...");
        const _0x422c75 = this._locationToImageIdMap[_0x3f24f3];
        const _0x595433 = _0x422c75 === "processing";
        this.ctx.log("image-gen", "[朋友圈] 缓存查找 - locationHash: " + _0x3f24f3.substring(0, 8) + "..., cachedImageId: " + _0x422c75 + ", isProcessing: " + _0x595433);
        let _0x434ce8;
        if (_0x422c75 && _0x422c75 !== "processing") {
          _0x434ce8 = "<div class=\"tsp-moments-image-slot\" data-location-hash=\"" + _0x3f24f3 + "\" data-image-id=\"" + _0x422c75 + "\">\n                        <button class=\"tsp-inline-gen-btn tsp-regenerate-btn\"\n                                data-link=\"" + this._escapeHtml(_0x1f33ed) + "\"\n                                data-location-hash=\"" + _0x3f24f3 + "\"\n                                data-match-index=\"" + _0x113bfb + "\"\n                                title=\"重新生成图片\">\n                            生成图片\n                        </button>\n                        <img class=\"tsp-generated-image tsp-moments-image\"\n                             src=\"" + TRANSPARENT_PIXEL + "\"\n                             data-is-loaded=\"false\"\n                             data-image-id=\"" + _0x422c75 + "\"\n                             data-location-hash=\"" + _0x3f24f3 + "\"\n                             alt=\"朋友圈图片\"\n                             style=\"max-width:100%; max-height:400px; cursor:pointer; border-radius:8px; min-height: 50px; background: rgba(122,162,247,0.1);\">\n                    </div>";
        } else if (_0x595433) {
          _0x434ce8 = "<button class=\"tsp-inline-gen-btn\"\n                            data-link=\"" + this._escapeHtml(_0x1f33ed) + "\"\n                            data-location-hash=\"" + _0x3f24f3 + "\"\n                            data-match-index=\"" + _0x113bfb + "\"\n                            disabled=\"true\">\n                        <i class=\"fa-solid fa-spinner fa-spin\"></i> ⏳ 处理中...\n                    </button>";
        } else {
          _0x434ce8 = "<button class=\"tsp-inline-gen-btn\" data-link=\"" + this._escapeHtml(_0x1f33ed) + "\" data-location-hash=\"" + _0x3f24f3 + "\" data-match-index=\"" + _0x113bfb + "\" title=\"点击生成图片\">\n                        <i class=\"fa-solid fa-image\"></i> 生成图片\n                    </button>";
        }
        _0x35596c = _0x35596c.replace(_0xb5514, _0x434ce8);
        _0x113bfb++;
      }
      if (_0x35596c !== _0x1bce97) {
        _0x17f87e.innerHTML = _0x35596c;
        _0x482ada.dataset.tspProcessed = "true";
        const _0x330e1c = _0x17f87e.querySelectorAll(".tsp-inline-gen-btn");
        _0x330e1c.forEach(_0x1c4a26 => {
          const _0x4f35e9 = _0x1c4a26;
          if (!_0x4f35e9.dataset.bound) {
            _0x4f35e9.dataset.bound = "true";
            _0x4f35e9.addEventListener("click", _0x410c4e => this._handleMomentsInlineButtonClick(_0x410c4e, _0x4f35e9, _0x3dd982));
          }
        });
        const _0x3139c4 = _0x17f87e.querySelectorAll("img.tsp-moments-image[data-is-loaded=\"false\"]");
        if (_0x3139c4.length > 0) {
          requestAnimationFrame(async () => {
            for (const _0x10aff7 of _0x3139c4) {
              const _0xad5789 = _0x10aff7;
              const _0x1eab16 = _0xad5789.dataset.imageId;
              if (!_0x1eab16) {
                continue;
              }
              this.ctx.log("image-gen", "[朋友圈] 直接加载图片 ID:" + _0x1eab16);
              const _0x585aa9 = () => {
                _0xad5789.style.height = "auto";
                _0xad5789.style.minHeight = "";
                _0xad5789.onload = null;
              };
              try {
                const _0x29f631 = await this.getCachedImage(parseInt(_0x1eab16));
                if (_0x29f631) {
                  const _0x79c1bd = this._zoomRatio || 100;
                  _0xad5789.style.maxWidth = _0x79c1bd + "%";
                  _0xad5789.onload = _0x585aa9;
                  if (_0x29f631.serverPath) {
                    this.ctx.log("image-gen", "[朋友圈] ID:" + _0x1eab16 + " 使用 serverPath: " + _0x29f631.serverPath);
                    _0xad5789.src = _0x29f631.serverPath;
                  } else if (_0x29f631.imageData) {
                    if (_0xad5789.src.startsWith("blob:")) {
                      URL.revokeObjectURL(_0xad5789.src);
                    }
                    if (_0x29f631.imageData instanceof Blob) {
                      const _0x286b1d = URL.createObjectURL(_0x29f631.imageData);
                      this.ctx.log("image-gen", "[朋友圈] ID:" + _0x1eab16 + " 从 Blob 创建 URL: " + _0x286b1d);
                      _0xad5789.src = _0x286b1d;
                    } else {
                      const _0xcd9d17 = this._dataURLtoBlob(_0x29f631.imageData);
                      if (_0xcd9d17) {
                        const _0x1df37a = URL.createObjectURL(_0xcd9d17);
                        this.ctx.log("image-gen", "[朋友圈] ID:" + _0x1eab16 + " 从 Base64 转换为 Blob URL: " + _0x1df37a);
                        _0xad5789.src = _0x1df37a;
                      } else {
                        this.ctx.log("image-gen", "[朋友圈] ID:" + _0x1eab16 + " 使用 Base64 字符串");
                        _0xad5789.src = _0x29f631.imageData;
                      }
                    }
                  }
                  _0xad5789.dataset.isLoaded = "true";
                  this.ctx.log("image-gen", "[朋友圈] ID:" + _0x1eab16 + " 加载完成");
                  if (_0xad5789.ownerDocument === document && this.interactionManager) {
                    this.interactionManager.addSmartClickHandler(_0xad5789);
                  }
                }
              } catch (_0x4800d8) {
                this.ctx.error("image-gen", "[朋友圈] ID:" + _0x1eab16 + " 加载失败", _0x4800d8);
              }
            }
          });
        }
      }
    });
  }
  scanPhoneForum() {
    const _0x1a4852 = document.getElementById("tsp-phone-forum-content");
    if (!_0x1a4852) {
      return;
    }
    const _0x47de3e = _0x1a4852.querySelectorAll(".tsp-phone-forum-post-card");
    if (_0x47de3e.length === 0) {
      return;
    }
    this.ctx.log("image-gen", "[论坛] 开始扫描 " + _0x47de3e.length + " 条论坛帖子");
    _0x47de3e.forEach((_0xd951e2, _0x34217a) => {
      const _0x42b66b = _0xd951e2.querySelector(".tsp-phone-forum-post-image");
      if (!_0x42b66b) {
        return;
      }
      const _0x3739e8 = _0x42b66b.querySelector(".tsp-phone-forum-image-caption");
      if (!_0x3739e8) {
        return;
      }
      const _0x54cb29 = _0x3739e8.textContent || _0x3739e8.innerHTML || "";
      const _0x593036 = _0x54cb29.includes("image###");
      if (!_0x593036 && _0x42b66b.dataset.tspProcessed === "true") {
        return;
      }
      if (_0x593036) {
        delete _0x42b66b.dataset.tspProcessed;
      }
      const _0x578969 = /image###([\s\S]*?)###/g;
      const _0xf29156 = [..._0x54cb29.matchAll(_0x578969)];
      if (_0xf29156.length === 0) {
        return;
      }
      const _0x23340c = _0xd951e2.dataset.postId || "forum_" + _0x34217a;
      this.ctx.log("image-gen", "[论坛] 处理论坛帖子 - postId: " + _0x23340c);
      let _0xc41728 = 0;
      let _0x1c89ed = _0x54cb29;
      for (const _0x437cde of _0xf29156) {
        const _0x19454a = _0x437cde[0];
        const _0x3611d0 = _0x437cde[1].trim();
        const _0x1eb091 = this._createStableLinkContent(_0x3611d0);
        const _0x1a7a9a = this._md5(_0x23340c + "-" + _0x1eb091 + "-" + _0xc41728);
        this.ctx.log("image-gen", "[论坛] 哈希计算 - postId: " + _0x23340c + ", link: " + _0x1eb091.substring(0, 30) + "..., locationHash: " + _0x1a7a9a.substring(0, 8) + "...");
        const _0x30c002 = this._locationToImageIdMap[_0x1a7a9a];
        const _0x500968 = _0x30c002 === "processing";
        this.ctx.log("image-gen", "[论坛] 缓存查找 - locationHash: " + _0x1a7a9a.substring(0, 8) + "..., cachedImageId: " + _0x30c002 + ", isProcessing: " + _0x500968);
        let _0x42153e;
        if (_0x30c002 && _0x30c002 !== "processing") {
          _0x42153e = "<div class=\"tsp-forum-image-slot\" data-location-hash=\"" + _0x1a7a9a + "\" data-image-id=\"" + _0x30c002 + "\">\n                        <button class=\"tsp-inline-gen-btn tsp-regenerate-btn\"\n                                data-link=\"" + this._escapeHtml(_0x1eb091) + "\"\n                                data-location-hash=\"" + _0x1a7a9a + "\"\n                                data-match-index=\"" + _0xc41728 + "\"\n                                title=\"重新生成图片\">\n                            生成图片\n                        </button>\n                        <img class=\"tsp-generated-image tsp-forum-image\"\n                             src=\"" + TRANSPARENT_PIXEL + "\"\n                             data-is-loaded=\"false\"\n                             data-image-id=\"" + _0x30c002 + "\"\n                             data-location-hash=\"" + _0x1a7a9a + "\"\n                             alt=\"论坛图片\"\n                             style=\"max-width:100%; max-height:400px; cursor:pointer; border-radius:8px; min-height: 50px; background: rgba(122,162,247,0.1);\">\n                    </div>";
        } else if (_0x500968) {
          _0x42153e = "<button class=\"tsp-inline-gen-btn\"\n                            data-link=\"" + this._escapeHtml(_0x1eb091) + "\"\n                            data-location-hash=\"" + _0x1a7a9a + "\"\n                            data-match-index=\"" + _0xc41728 + "\"\n                            disabled=\"true\">\n                        <i class=\"fa-solid fa-spinner fa-spin\"></i> ⏳ 处理中...\n                    </button>";
        } else {
          _0x42153e = "<button class=\"tsp-inline-gen-btn\" data-link=\"" + this._escapeHtml(_0x1eb091) + "\" data-location-hash=\"" + _0x1a7a9a + "\" data-match-index=\"" + _0xc41728 + "\" title=\"点击生成图片\">\n                        <i class=\"fa-solid fa-image\"></i> 生成图片\n                    </button>";
        }
        _0x1c89ed = _0x1c89ed.replace(_0x19454a, _0x42153e);
        _0xc41728++;
      }
      if (_0x1c89ed !== _0x54cb29) {
        _0x3739e8.innerHTML = _0x1c89ed;
        _0x42b66b.dataset.tspProcessed = "true";
        const _0x5825d0 = _0x3739e8.querySelectorAll(".tsp-inline-gen-btn");
        _0x5825d0.forEach(_0x304b28 => {
          const _0x58f75b = _0x304b28;
          if (!_0x58f75b.dataset.bound) {
            _0x58f75b.dataset.bound = "true";
            _0x58f75b.addEventListener("click", _0x10f942 => this._handleForumInlineButtonClick(_0x10f942, _0x58f75b, _0xd951e2));
          }
        });
        const _0x63fcc6 = _0x3739e8.querySelectorAll("img.tsp-forum-image[data-is-loaded=\"false\"]");
        if (_0x63fcc6.length > 0) {
          requestAnimationFrame(async () => {
            for (const _0x2598c5 of _0x63fcc6) {
              const _0x52939a = _0x2598c5;
              const _0x4cff7a = _0x52939a.dataset.imageId;
              if (!_0x4cff7a) {
                continue;
              }
              this.ctx.log("image-gen", "[论坛] 直接加载图片 ID:" + _0x4cff7a);
              const _0x39e8c3 = () => {
                _0x52939a.style.height = "auto";
                _0x52939a.style.minHeight = "";
                _0x52939a.onload = null;
              };
              try {
                const _0x160ccd = await this.getCachedImage(parseInt(_0x4cff7a));
                if (_0x160ccd) {
                  const _0xb720b8 = this._zoomRatio || 100;
                  _0x52939a.style.maxWidth = _0xb720b8 + "%";
                  _0x52939a.onload = _0x39e8c3;
                  if (_0x160ccd.serverPath) {
                    this.ctx.log("image-gen", "[论坛] ID:" + _0x4cff7a + " 使用 serverPath: " + _0x160ccd.serverPath);
                    _0x52939a.src = _0x160ccd.serverPath;
                  } else if (_0x160ccd.imageData) {
                    if (_0x52939a.src.startsWith("blob:")) {
                      URL.revokeObjectURL(_0x52939a.src);
                    }
                    if (_0x160ccd.imageData instanceof Blob) {
                      const _0x4ea4cc = URL.createObjectURL(_0x160ccd.imageData);
                      this.ctx.log("image-gen", "[论坛] ID:" + _0x4cff7a + " 从 Blob 创建 URL: " + _0x4ea4cc);
                      _0x52939a.src = _0x4ea4cc;
                    } else {
                      const _0x2470b4 = this._dataURLtoBlob(_0x160ccd.imageData);
                      if (_0x2470b4) {
                        const _0x3b8714 = URL.createObjectURL(_0x2470b4);
                        this.ctx.log("image-gen", "[论坛] ID:" + _0x4cff7a + " 从 Base64 转换为 Blob URL: " + _0x3b8714);
                        _0x52939a.src = _0x3b8714;
                      } else {
                        this.ctx.log("image-gen", "[论坛] ID:" + _0x4cff7a + " 使用 Base64 字符串");
                        _0x52939a.src = _0x160ccd.imageData;
                      }
                    }
                  }
                  _0x52939a.dataset.isLoaded = "true";
                  this.ctx.log("image-gen", "[论坛] ID:" + _0x4cff7a + " 加载完成");
                  if (_0x52939a.ownerDocument === document && this.interactionManager) {
                    this.interactionManager.addSmartClickHandler(_0x52939a);
                  }
                }
              } catch (_0x4adc77) {
                this.ctx.error("image-gen", "[论坛] ID:" + _0x4cff7a + " 加载失败", _0x4adc77);
              }
            }
          });
        }
      }
    });
  }
  _hashString(_0x4415ea) {
    const _0x1a21d6 = this._md5(_0x4415ea);
    return _0x1a21d6.substring(0, 15);
  }
  scanPhoneLivestreaming() {
    const _0x2cd95d = document.querySelector(".tsp-phone-livestreaming-room-video-area");
    if (!_0x2cd95d) {
      return;
    }
    const _0x3c1035 = document.querySelector(".tsp-phone-livestreaming-room-detail-viewers-count");
    if (!_0x3c1035) {
      return;
    }
    const _0x130f90 = document.querySelectorAll(".tsp-generated-image.tsp-livestreaming-image");
    _0x130f90.forEach(_0x594268 => {
      if (this.interactionManager) {
        this.interactionManager.addSmartClickHandler(_0x594268);
      }
    });
    let _0x599980 = "";
    let _0x492ca9 = "unknown";
    let _0x429a95 = "";
    if (_0x2cd95d.dataset.tag) {
      const _0x1312ca = /image###([\s\S]*?)###/g;
      const _0x4089f9 = [..._0x2cd95d.dataset.tag.matchAll(_0x1312ca)];
      if (_0x4089f9.length > 0) {
        _0x599980 = _0x4089f9[0][1];
      } else {
        _0x599980 = _0x2cd95d.dataset.tag;
      }
      _0x492ca9 = _0x2cd95d.dataset.floorId || "unknown";
      _0x429a95 = _0x2cd95d.dataset.roomId || "";
    }
    const _0x4ab9d5 = document.querySelectorAll(".tsp-livestreaming-gen-btn");
    _0x4ab9d5.forEach(_0x52f5de => _0x52f5de.remove());
    if (_0x599980) {
      const _0x21f9da = this._hashString(_0x599980);
      const _0x40b819 = _0x429a95 ? "livestreaming-" + _0x429a95 + "-" + _0x492ca9 + "-" + _0x21f9da : "livestreaming-" + _0x492ca9 + "-" + _0x21f9da;
      const _0x37c3fa = this._locationToImageIdMap[_0x40b819];
      const _0x127800 = _0x37c3fa === "processing";
      let _0x272696;
      if (_0x37c3fa && _0x37c3fa !== "processing") {
        _0x272696 = "<button class=\"tsp-livestreaming-gen-btn tsp-inline-gen-btn tsp-regenerate-btn\"\n                        data-tag=\"" + this._escapeHtml(_0x599980) + "\"\n                        data-location-hash=\"" + _0x40b819 + "\"\n                        data-match-index=\"0\"\n                        title=\"重新生成图片\">\n                    生成图片\n                </button>";
      } else if (_0x127800) {
        _0x272696 = "<button class=\"tsp-livestreaming-gen-btn tsp-inline-gen-btn\"\n                        data-tag=\"" + this._escapeHtml(_0x599980) + "\"\n                        data-location-hash=\"" + _0x40b819 + "\"\n                        data-match-index=\"0\"\n                        disabled=\"true\">\n                    <i class=\"fa-solid fa-spinner fa-spin\"></i> ⏳ 处理中...\n                </button>";
      } else {
        _0x272696 = "<button class=\"tsp-livestreaming-gen-btn tsp-inline-gen-btn\"\n                        data-tag=\"" + this._escapeHtml(_0x599980) + "\"\n                        data-location-hash=\"" + _0x40b819 + "\"\n                        data-match-index=\"0\"\n                        title=\"点击生成图片\">\n                    <i class=\"fa-solid fa-image\"></i> 生成图片\n                </button>";
      }
      _0x3c1035.insertAdjacentHTML("beforebegin", _0x272696);
      const _0x5c9004 = document.querySelectorAll(".tsp-livestreaming-gen-btn");
      _0x5c9004.forEach(_0x3293ea => {
        const _0x4f15c3 = _0x3293ea;
        if (!_0x4f15c3.dataset.bound) {
          _0x4f15c3.dataset.bound = "true";
          _0x4f15c3.addEventListener("click", _0xc0f564 => this._handleLivestreamingButtonClick(_0xc0f564, _0x4f15c3, _0x2cd95d));
        }
      });
      if (_0x37c3fa && _0x37c3fa !== "processing") {
        const _0xcfaff5 = document.querySelector("#tsp-livestreaming-image-container");
        if (_0xcfaff5) {
          _0xcfaff5.innerHTML = "<img class=\"tsp-generated-image tsp-livestreaming-image\"\n                         src=\"" + TRANSPARENT_PIXEL + "\"\n                         data-is-loaded=\"false\"\n                         data-image-id=\"" + _0x37c3fa + "\"\n                         data-location-hash=\"" + _0x40b819 + "\"\n                         alt=\"直播标签图片\"\n                         style=\"max-width:100%; max-height:100%; object-fit:contain;\">";
          const _0x5679e6 = _0xcfaff5.querySelector(".tsp-generated-image");
          if (_0x5679e6) {
            requestAnimationFrame(() => {
              const _0x1ad2f1 = _0x5679e6;
              const _0x10a0d8 = _0x1ad2f1.dataset.imageId;
              if (!_0x10a0d8 || _0x1ad2f1.dataset.loaded === "true") {
                return;
              }
              this.ctx.log("image-gen", "[直播页面] 直接加载图片 ID:" + _0x10a0d8);
              const _0x2c10d6 = () => {
                _0x1ad2f1.style.height = "auto";
                _0x1ad2f1.onload = null;
              };
              this.getCachedImage(parseInt(_0x10a0d8)).then(_0x438136 => {
                if (_0x438136) {
                  const _0x47ce1c = this._zoomRatio || 100;
                  _0x1ad2f1.style.maxWidth = _0x47ce1c + "%";
                  _0x1ad2f1.onload = _0x2c10d6;
                  if (_0x438136.serverPath) {
                    this.ctx.log("image-gen", "[直播页面] ID:" + _0x10a0d8 + " 使用 serverPath: " + _0x438136.serverPath);
                    _0x1ad2f1.src = _0x438136.serverPath;
                  } else if (_0x438136.imageData) {
                    if (_0x1ad2f1.src.startsWith("blob:")) {
                      URL.revokeObjectURL(_0x1ad2f1.src);
                    }
                    if (_0x438136.imageData instanceof Blob) {
                      const _0x3c74bc = URL.createObjectURL(_0x438136.imageData);
                      this.ctx.log("image-gen", "[直播页面] ID:" + _0x10a0d8 + " 从 Blob 创建 URL: " + _0x3c74bc);
                      _0x1ad2f1.src = _0x3c74bc;
                    } else {
                      const _0x49ece8 = this._dataURLtoBlob(_0x438136.imageData);
                      if (_0x49ece8) {
                        const _0x23fa3c = URL.createObjectURL(_0x49ece8);
                        this.ctx.log("image-gen", "[直播页面] ID:" + _0x10a0d8 + " 从 Base64 转换为 Blob URL: " + _0x23fa3c);
                        _0x1ad2f1.src = _0x23fa3c;
                      } else {
                        this.ctx.log("image-gen", "[直播页面] ID:" + _0x10a0d8 + " 使用 Base64 字符串");
                        _0x1ad2f1.src = _0x438136.imageData;
                      }
                    }
                  }
                  _0x1ad2f1.dataset.loaded = "true";
                  this.ctx.log("image-gen", "[直播页面] ID:" + _0x10a0d8 + " 加载完成");
                  if (this.interactionManager) {
                    this.interactionManager.addSmartClickHandler(_0x1ad2f1);
                  }
                }
              }).catch(_0x31d637 => {
                this.ctx.error("image-gen", "[直播页面] ID:" + _0x10a0d8 + " 加载失败", _0x31d637);
              });
            });
          }
        }
      } else {
        const _0x29bab3 = document.querySelector("#tsp-livestreaming-image-container");
        if (_0x29bab3) {
          _0x29bab3.innerHTML = "";
        }
      }
    } else {
      const _0x33c209 = document.querySelector("#tsp-livestreaming-image-container");
      if (_0x33c209) {
        _0x33c209.innerHTML = "";
      }
    }
  }
  scanPhoneMinutes() {
    const _0x37b147 = document.querySelector(".tsp-minutes-panel");
    if (!_0x37b147) {
      return;
    }
    const _0x4d8232 = _0x37b147.querySelectorAll(".tsp-minutes-char-card");
    _0x4d8232.forEach(_0x45f265 => {
      const _0x37839c = _0x45f265.querySelector(".tsp-minutes-char-img-container");
      if (!_0x37839c) {
        return;
      }
      const _0x3c4978 = _0x45f265.dataset.characterId;
      if (_0x3c4978) {
        const _0x2af980 = "beauty-" + _0x3c4978;
        const _0x4cefe8 = this._locationToImageIdMap[_0x2af980];
        if (_0x4cefe8 && _0x4cefe8 !== "processing") {
          _0x37839c.innerHTML = "<img class=\"tsp-generated-image tsp-minutes-image\"\n                         src=\"" + TRANSPARENT_PIXEL + "\"\n                         data-is-loaded=\"false\"\n                         data-image-id=\"" + _0x4cefe8 + "\"\n                         data-location-hash=\"" + _0x2af980 + "\"\n                         alt=\"角色立绘\"\n                         style=\"max-width:100%; max-height:300px; border-radius:8px;\">";
          const _0x526976 = _0x37839c.querySelector(".tsp-generated-image");
          if (_0x526976) {
            requestAnimationFrame(() => {
              const _0x58e871 = _0x526976;
              const _0x355603 = _0x58e871.dataset.imageId;
              if (!_0x355603 || _0x58e871.dataset.loaded === "true") {
                return;
              }
              this.ctx.log("image-gen", "[剧情百科] 直接加载图片 ID:" + _0x355603);
              const _0x5b0e5a = () => {
                _0x58e871.style.height = "auto";
                _0x58e871.onload = null;
                if (_0x58e871.naturalWidth && _0x58e871.naturalHeight) {
                  const _0x1ef9eb = _0x58e871.closest(".tsp-minutes-char-img-container");
                  if (_0x1ef9eb) {
                    const _0x5078c6 = _0x1ef9eb.closest(".tsp-minutes-char-card");
                    _0x1ef9eb.classList.remove("tsp-minutes-char-img-container", "tsp-minutes-char-img-container-horizontal", "tsp-minutes-char-img-container-square");
                    if (_0x5078c6) {
                      _0x5078c6.classList.remove("tsp-minutes-char-card-horizontal", "tsp-minutes-char-card-square");
                    }
                    if (_0x58e871.naturalWidth === 1216 && _0x58e871.naturalHeight === 832) {
                      _0x1ef9eb.classList.add("tsp-minutes-char-img-container-horizontal");
                      if (_0x5078c6) {
                        _0x5078c6.classList.add("tsp-minutes-char-card-horizontal");
                      }
                    } else if (_0x58e871.naturalWidth === 1024 && _0x58e871.naturalHeight === 1024) {
                      _0x1ef9eb.classList.add("tsp-minutes-char-img-container-square");
                      if (_0x5078c6) {
                        _0x5078c6.classList.add("tsp-minutes-char-card-square");
                      }
                    } else {
                      _0x1ef9eb.classList.add("tsp-minutes-char-img-container");
                    }
                  }
                }
              };
              this.getCachedImage(parseInt(_0x355603)).then(_0x35f9a9 => {
                if (_0x35f9a9) {
                  const _0x315c4b = this._zoomRatio || 100;
                  _0x58e871.style.maxWidth = _0x315c4b + "%";
                  _0x58e871.onload = _0x5b0e5a;
                  if (_0x35f9a9.serverPath) {
                    this.ctx.log("image-gen", "[剧情百科] ID:" + _0x355603 + " 使用 serverPath: " + _0x35f9a9.serverPath);
                    _0x58e871.src = _0x35f9a9.serverPath;
                  } else if (_0x35f9a9.imageData) {
                    if (_0x58e871.src.startsWith("blob:")) {
                      URL.revokeObjectURL(_0x58e871.src);
                    }
                    if (_0x35f9a9.imageData instanceof Blob) {
                      const _0x2c2e20 = URL.createObjectURL(_0x35f9a9.imageData);
                      this.ctx.log("image-gen", "[剧情百科] ID:" + _0x355603 + " 从 Blob 创建 URL: " + _0x2c2e20);
                      _0x58e871.src = _0x2c2e20;
                    } else {
                      const _0x144d19 = this._dataURLtoBlob(_0x35f9a9.imageData);
                      if (_0x144d19) {
                        const _0x409cf4 = URL.createObjectURL(_0x144d19);
                        this.ctx.log("image-gen", "[剧情百科] ID:" + _0x355603 + " 从 Base64 转换为 Blob URL: " + _0x409cf4);
                        _0x58e871.src = _0x409cf4;
                      } else {
                        this.ctx.log("image-gen", "[剧情百科] ID:" + _0x355603 + " 使用 Base64 字符串");
                        _0x58e871.src = _0x35f9a9.imageData;
                      }
                    }
                  }
                  _0x58e871.dataset.loaded = "true";
                  this.ctx.log("image-gen", "[剧情百科] ID:" + _0x355603 + " 加载完成");
                }
              }).catch(_0x29b606 => {
                this.ctx.error("image-gen", "[剧情百科] ID:" + _0x355603 + " 加载失败", _0x29b606);
              });
            });
          }
        } else {
          _0x37839c.innerHTML = "";
        }
      } else {
        _0x37839c.innerHTML = "";
      }
    });
    const _0x48629d = _0x37b147.querySelectorAll(".tsp-relationship-node");
    _0x48629d.forEach(_0x4c7c96 => {
      const _0x2bdfd7 = _0x4c7c96.querySelector(".tsp-relationship-avatar");
      if (!_0x2bdfd7) {
        return;
      }
      const _0x1287cb = _0x4c7c96.querySelector(".tsp-relationship-node-name");
      if (!_0x1287cb) {
        return;
      }
      const _0x46107a = _0x1287cb.textContent;
      let _0x4690ba = null;
      if (chat && Array.isArray(chat)) {
        for (let _0x5e4122 = chat.length - 1; _0x5e4122 >= 0; _0x5e4122--) {
          const _0x2f0bb0 = chat[_0x5e4122];
          if (_0x2f0bb0.is_user) {
            continue;
          }
          if (_0x2f0bb0.TSP_Phone_CharacterData) {
            for (const _0x4c3f68 in _0x2f0bb0.TSP_Phone_CharacterData) {
              const _0x588e5a = _0x2f0bb0.TSP_Phone_CharacterData[_0x4c3f68];
              if (_0x588e5a.姓名 === _0x46107a || _0x588e5a.name === _0x46107a) {
                _0x4690ba = _0x4c3f68;
                break;
              }
            }
            if (_0x4690ba) {
              break;
            }
          }
        }
      }
      if (_0x4690ba) {
        const _0x4bd7ca = "beauty-" + _0x4690ba;
        const _0x269f5f = this._locationToImageIdMap[_0x4bd7ca];
        if (_0x269f5f && _0x269f5f !== "processing") {
          _0x2bdfd7.innerHTML = "<img class=\"tsp-generated-image tsp-minutes-image\"\n                         src=\"" + TRANSPARENT_PIXEL + "\"\n                         data-is-loaded=\"false\"\n                         data-image-id=\"" + _0x269f5f + "\"\n                         data-location-hash=\"" + _0x4bd7ca + "\"\n                         alt=\"" + _0x46107a + "\"\n                         style=\"max-width:100%; max-height:60px; border-radius:50%;\">";
          const _0x874296 = _0x2bdfd7.querySelector(".tsp-generated-image");
          if (_0x874296) {
            requestAnimationFrame(() => {
              const _0x500005 = _0x874296;
              const _0x575f67 = _0x500005.dataset.imageId;
              if (!_0x575f67 || _0x500005.dataset.loaded === "true") {
                return;
              }
              this.ctx.log("image-gen", "[关系图] 直接加载图片 ID:" + _0x575f67);
              const _0x59447d = () => {
                _0x500005.style.height = "auto";
                _0x500005.onload = null;
              };
              this.getCachedImage(parseInt(_0x575f67)).then(_0x231a79 => {
                if (_0x231a79) {
                  const _0x4f9094 = this._zoomRatio || 100;
                  _0x500005.style.maxWidth = _0x4f9094 + "%";
                  _0x500005.onload = _0x59447d;
                  if (_0x231a79.serverPath) {
                    this.ctx.log("image-gen", "[关系图] ID:" + _0x575f67 + " 使用 serverPath: " + _0x231a79.serverPath);
                    _0x500005.src = _0x231a79.serverPath;
                  } else if (_0x231a79.imageData) {
                    if (_0x500005.src.startsWith("blob:")) {
                      URL.revokeObjectURL(_0x500005.src);
                    }
                    if (_0x231a79.imageData instanceof Blob) {
                      const _0x4634c0 = URL.createObjectURL(_0x231a79.imageData);
                      this.ctx.log("image-gen", "[关系图] ID:" + _0x575f67 + " 从 Blob 创建 URL: " + _0x4634c0);
                      _0x500005.src = _0x4634c0;
                    } else {
                      const _0x5f14cb = this._dataURLtoBlob(_0x231a79.imageData);
                      if (_0x5f14cb) {
                        const _0xadab80 = URL.createObjectURL(_0x5f14cb);
                        this.ctx.log("image-gen", "[关系图] ID:" + _0x575f67 + " 从 Base64 转换为 Blob URL: " + _0xadab80);
                        _0x500005.src = _0xadab80;
                      } else {
                        this.ctx.log("image-gen", "[关系图] ID:" + _0x575f67 + " 使用 Base64 字符串");
                        _0x500005.src = _0x231a79.imageData;
                      }
                    }
                  }
                  _0x500005.dataset.loaded = "true";
                  this.ctx.log("image-gen", "[关系图] ID:" + _0x575f67 + " 加载完成");
                }
              }).catch(_0x1cab9b => {
                this.ctx.error("image-gen", "[关系图] ID:" + _0x575f67 + " 加载失败", _0x1cab9b);
              });
            });
          }
        }
      }
    });
    const _0x1977f3 = _0x37b147.querySelector("#tsp-minutes-character-beauty-detail");
    if (_0x1977f3) {
      const _0x6ac23e = _0x1977f3.querySelector(".tsp-minutes-beauty-detail-left");
      const _0x32e0ab = _0x1977f3.querySelector(".tsp-minutes-detail-header");
      const _0x8d5942 = _0x32e0ab?.querySelector(".tsp-minutes-detail-edit-btn");
      if (_0x6ac23e && _0x32e0ab && _0x8d5942) {
        const _0x42a010 = _0x1977f3.dataset.characterId;
        const _0x2926a0 = _0x1977f3.dataset.illustration;
        if (_0x2926a0 && _0x2926a0.includes("image###")) {
          const _0x53d22a = _0x2926a0.replace(/image###|###/g, "");
          _0x6ac23e.innerHTML = "<img class=\"tsp-minutes-beauty-detail-img\" src=\"" + _0x53d22a + "\" alt=\"角色图片\">";
        } else {
          let _0x93045b = "未知";
          if (chat && Array.isArray(chat)) {
            for (let _0x10b52a = chat.length - 1; _0x10b52a >= 0; _0x10b52a--) {
              const _0xdaba59 = chat[_0x10b52a];
              if (_0xdaba59.is_user) {
                continue;
              }
              if (_0xdaba59.TSP_Phone_CharacterData && _0xdaba59.TSP_Phone_CharacterData[_0x42a010]) {
                _0x93045b = _0xdaba59.TSP_Phone_CharacterData[_0x42a010].姓名 || _0xdaba59.TSP_Phone_CharacterData[_0x42a010].name || "未知";
                break;
              }
            }
          }
          const _0x18ab55 = _0x93045b.charAt(0);
          _0x6ac23e.innerHTML = "<div class=\"tsp-minutes-avatar-placeholder\">" + _0x18ab55 + "</div>";
        }
        if (_0x42a010 && _0x2926a0) {
          const _0x231f83 = _0x2926a0.replace(/image###|###/g, "");
          const _0x20188c = "beauty-" + _0x42a010;
          const _0x5f2707 = this._locationToImageIdMap[_0x20188c];
          const _0x46b108 = _0x5f2707 === "processing";
          let _0x194d83;
          if (_0x5f2707 && _0x5f2707 !== "processing") {
            _0x194d83 = "<button class=\"tsp-inline-gen-btn tsp-regenerate-btn\"\n                                data-link=\"" + this._escapeHtml(_0x231f83) + "\"\n                                data-location-hash=\"" + _0x20188c + "\"\n                                data-match-index=\"0\"\n                                title=\"重新生成图片\">\n                            生成图片\n                        </button>";
          } else if (_0x46b108) {
            _0x194d83 = "<button class=\"tsp-inline-gen-btn\"\n                                data-link=\"" + this._escapeHtml(_0x231f83) + "\"\n                                data-location-hash=\"" + _0x20188c + "\"\n                                data-match-index=\"0\"\n                                disabled=\"true\">\n                            <i class=\"fa-solid fa-spinner fa-spin\"></i> ⏳ 处理中...\n                        </button>";
          } else {
            _0x194d83 = "<button class=\"tsp-inline-gen-btn\" data-link=\"" + this._escapeHtml(_0x231f83) + "\" data-location-hash=\"" + _0x20188c + "\" data-match-index=\"0\" title=\"点击生成图片\">\n                            <i class=\"fa-solid fa-image\"></i> 生成图片\n                        </button>";
          }
          const _0x2c9f5c = _0x32e0ab.querySelectorAll(".tsp-inline-gen-btn");
          _0x2c9f5c.forEach(_0x3887e9 => _0x3887e9.remove());
          _0x8d5942.insertAdjacentHTML("beforebegin", _0x194d83);
          const _0x52f6a8 = _0x32e0ab.querySelectorAll(".tsp-inline-gen-btn");
          _0x52f6a8.forEach(_0x5c5e5a => {
            const _0x10fd00 = _0x5c5e5a;
            if (!_0x10fd00.dataset.bound) {
              _0x10fd00.dataset.bound = "true";
              _0x10fd00.addEventListener("click", _0x166aaf => this._handleMinutesInlineButtonClick(_0x166aaf, _0x10fd00, _0x1977f3));
            }
          });
          if (_0x5f2707 && _0x5f2707 !== "processing") {
            _0x6ac23e.innerHTML = "<img class=\"tsp-generated-image tsp-minutes-image\"\n                             src=\"" + TRANSPARENT_PIXEL + "\"\n                             data-is-loaded=\"false\"\n                             data-image-id=\"" + _0x5f2707 + "\"\n                             data-location-hash=\"" + _0x20188c + "\"\n                             alt=\"角色立绘\"\n                             style=\"max-width:100%; max-height:300px; border-radius:8px;\">";
            const _0x48d56a = _0x6ac23e.querySelectorAll(".tsp-generated-image");
            if (_0x48d56a.length > 0) {
              requestAnimationFrame(() => {
                for (const _0x5c9ba2 of _0x48d56a) {
                  const _0x419e8c = _0x5c9ba2;
                  const _0xd63f3d = _0x419e8c.dataset.imageId;
                  if (!_0xd63f3d || _0x419e8c.dataset.loaded === "true") {
                    continue;
                  }
                  this.ctx.log("image-gen", "[剧情百科] 直接加载图片 ID:" + _0xd63f3d);
                  const _0x4a5802 = () => {
                    _0x419e8c.style.height = "auto";
                    _0x419e8c.onload = null;
                  };
                  this.getCachedImage(parseInt(_0xd63f3d)).then(_0x5ce12f => {
                    if (_0x5ce12f) {
                      const _0x3681cd = this._zoomRatio || 100;
                      _0x419e8c.style.maxWidth = _0x3681cd + "%";
                      _0x419e8c.onload = _0x4a5802;
                      if (_0x5ce12f.serverPath) {
                        this.ctx.log("image-gen", "[剧情百科] ID:" + _0xd63f3d + " 使用 serverPath: " + _0x5ce12f.serverPath);
                        _0x419e8c.src = _0x5ce12f.serverPath;
                      } else if (_0x5ce12f.imageData) {
                        if (_0x419e8c.src.startsWith("blob:")) {
                          URL.revokeObjectURL(_0x419e8c.src);
                        }
                        if (_0x5ce12f.imageData instanceof Blob) {
                          const _0x337626 = URL.createObjectURL(_0x5ce12f.imageData);
                          this.ctx.log("image-gen", "[剧情百科] ID:" + _0xd63f3d + " 从 Blob 创建 URL: " + _0x337626);
                          _0x419e8c.src = _0x337626;
                        } else {
                          const _0x4f6601 = this._dataURLtoBlob(_0x5ce12f.imageData);
                          if (_0x4f6601) {
                            const _0x1b44d4 = URL.createObjectURL(_0x4f6601);
                            this.ctx.log("image-gen", "[剧情百科] ID:" + _0xd63f3d + " 从 Base64 转换为 Blob URL: " + _0x1b44d4);
                            _0x419e8c.src = _0x1b44d4;
                          } else {
                            this.ctx.log("image-gen", "[剧情百科] ID:" + _0xd63f3d + " 使用 Base64 字符串");
                            _0x419e8c.src = _0x5ce12f.imageData;
                          }
                        }
                      }
                      _0x419e8c.dataset.loaded = "true";
                      this.ctx.log("image-gen", "[剧情百科] ID:" + _0xd63f3d + " 加载完成");
                      if (_0x419e8c.ownerDocument === document && this.interactionManager) {
                        this.interactionManager.addSmartClickHandler(_0x419e8c);
                      }
                    }
                  }).catch(_0x7a782c => {
                    this.ctx.error("image-gen", "[剧情百科] ID:" + _0xd63f3d + " 加载失败", _0x7a782c);
                  });
                }
              });
            }
          } else {
            _0x6ac23e.innerHTML = "";
          }
        } else {
          _0x6ac23e.innerHTML = "";
          const _0x27097a = _0x32e0ab.querySelectorAll(".tsp-inline-gen-btn");
          _0x27097a.forEach(_0x1982bc => _0x1982bc.remove());
        }
      }
    }
  }
  _handleLivestreamingButtonClick(_0x35db4f, _0x318503, _0x593370) {
    _0x35db4f.preventDefault();
    _0x35db4f.stopPropagation();
    const _0x12df34 = _0x318503.dataset.tag;
    const _0x9b4f87 = _0x318503.dataset.locationHash;
    if (!_0x12df34 || !_0x9b4f87) {
      this.ctx.warn("image-gen", "[直播页面] 按钮缺少必要的data属性");
      return;
    }
    if (this._processingHashes.has(_0x9b4f87)) {
      this.ctx.log("image-gen", "[直播页面] 图片正在生成中，跳过重复请求");
      return;
    }
    this._locationToImageIdMap[_0x9b4f87] = "processing";
    this._processingHashes.add(_0x9b4f87);
    const _0x110fc1 = _0x318503.innerHTML;
    _0x318503.innerHTML = "<i class=\"fa-solid fa-spinner fa-spin\"></i> ⏳ 处理中...";
    _0x318503.disabled = true;
    const _0x3f2a4c = {
      locationHash: _0x9b4f87,
      skipInsertToChat: true,
      skipAiProcessing: false
    };
    this.generateFromPrompt(_0x12df34, "", _0x3f2a4c).then(_0x3ae18c => {
      if (_0x3ae18c.success) {
        this.ctx.log("image-gen", "[直播页面] 图片生成完成:", _0x3ae18c.imageId);
        _0x318503.innerHTML = "生成图片";
        _0x318503.className = "tsp-livestreaming-gen-btn tsp-inline-gen-btn tsp-regenerate-btn";
        _0x318503.disabled = false;
        this.scanPhoneLivestreaming();
      } else {
        this.ctx.log("image-gen", "[直播页面] 图片生成失败");
        _0x318503.innerHTML = _0x110fc1;
        _0x318503.disabled = false;
      }
    }).catch(_0x41bb0b => {
      this.ctx.error("image-gen", "[直播页面] 图片生成失败", _0x41bb0b);
      _0x318503.innerHTML = _0x110fc1;
      _0x318503.disabled = false;
    }).finally(() => {
      this._processingHashes.delete(_0x9b4f87);
    });
  }
  _handleMinutesInlineButtonClick(_0x2d9767, _0x14dff3, _0x5a751f) {
    _0x2d9767.preventDefault();
    _0x2d9767.stopPropagation();
    const _0x2cf51b = _0x14dff3.dataset.link;
    const _0x3f3828 = _0x14dff3.dataset.locationHash;
    if (!_0x2cf51b || !_0x3f3828) {
      this.ctx.warn("image-gen", "[剧情百科] 按钮缺少必要的data属性");
      return;
    }
    if (this._processingHashes.has(_0x3f3828)) {
      this.ctx.log("image-gen", "[剧情百科] 图片正在生成中，跳过重复请求");
      return;
    }
    this._locationToImageIdMap[_0x3f3828] = "processing";
    this._processingHashes.add(_0x3f3828);
    const _0x49d958 = _0x14dff3.innerHTML;
    _0x14dff3.innerHTML = "<i class=\"fa-solid fa-spinner fa-spin\"></i> ⏳ 处理中...";
    _0x14dff3.disabled = true;
    const _0x452dc7 = {
      locationHash: _0x3f3828,
      skipInsertToChat: true,
      skipAiProcessing: false
    };
    this.generateFromPrompt(_0x2cf51b, "", _0x452dc7).then(_0x36b5ad => {
      if (_0x36b5ad.success) {
        this.ctx.log("image-gen", "[剧情百科] 图片生成完成:", _0x36b5ad.imageId);
        _0x14dff3.innerHTML = "生成图片";
        _0x14dff3.className = "tsp-inline-gen-btn tsp-regenerate-btn";
        _0x14dff3.disabled = false;
        const _0xc45797 = _0x5a751f.querySelector(".tsp-minutes-beauty-detail-left");
        if (_0xc45797) {
          _0xc45797.innerHTML = "<img class=\"tsp-generated-image tsp-minutes-image\"\n                         src=\"" + TRANSPARENT_PIXEL + "\"\n                         data-is-loaded=\"false\"\n                         data-image-id=\"" + _0x36b5ad.imageId + "\"\n                         data-location-hash=\"" + _0x3f3828 + "\"\n                         alt=\"角色立绘\"\n                         style=\"max-width:100%; max-height:300px; border-radius:8px;\">";
          const _0xa240ba = _0xc45797.querySelector(".tsp-generated-image");
          if (_0xa240ba) {
            const _0x49bbfc = () => {
              _0xa240ba.style.height = "auto";
              _0xa240ba.onload = null;
            };
            this.getCachedImage(parseInt(_0x36b5ad.imageId)).then(_0x552a7a => {
              if (_0x552a7a) {
                const _0x59a308 = this._zoomRatio || 100;
                _0xa240ba.style.maxWidth = _0x59a308 + "%";
                _0xa240ba.onload = _0x49bbfc;
                if (_0x552a7a.serverPath) {
                  this.ctx.log("image-gen", "[剧情百科] ID:" + _0x36b5ad.imageId + " 使用 serverPath: " + _0x552a7a.serverPath);
                  _0xa240ba.src = _0x552a7a.serverPath;
                } else if (_0x552a7a.imageData) {
                  if (_0xa240ba.src.startsWith("blob:")) {
                    URL.revokeObjectURL(_0xa240ba.src);
                  }
                  if (_0x552a7a.imageData instanceof Blob) {
                    const _0x26c084 = URL.createObjectURL(_0x552a7a.imageData);
                    this.ctx.log("image-gen", "[剧情百科] ID:" + _0x36b5ad.imageId + " 从 Blob 创建 URL: " + _0x26c084);
                    _0xa240ba.src = _0x26c084;
                  } else {
                    const _0x173389 = this._dataURLtoBlob(_0x552a7a.imageData);
                    if (_0x173389) {
                      const _0x364017 = URL.createObjectURL(_0x173389);
                      this.ctx.log("image-gen", "[剧情百科] ID:" + _0x36b5ad.imageId + " 从 Base64 转换为 Blob URL: " + _0x364017);
                      _0xa240ba.src = _0x364017;
                    } else {
                      this.ctx.log("image-gen", "[剧情百科] ID:" + _0x36b5ad.imageId + " 使用 Base64 字符串");
                      _0xa240ba.src = _0x552a7a.imageData;
                    }
                  }
                }
                _0xa240ba.dataset.loaded = "true";
                this.ctx.log("image-gen", "[剧情百科] ID:" + _0x36b5ad.imageId + " 加载完成");
                if (_0xa240ba.ownerDocument === document && this.interactionManager) {
                  this.interactionManager.addSmartClickHandler(_0xa240ba);
                }
              }
            }).catch(_0x349935 => {
              this.ctx.error("image-gen", "[剧情百科] ID:" + _0x36b5ad.imageId + " 加载失败", _0x349935);
            });
          }
        }
      } else {
        this.ctx.warn("image-gen", "[剧情百科] 图片生成失败");
        _0x14dff3.innerHTML = _0x49d958;
        _0x14dff3.disabled = false;
      }
    }).catch(_0x3ef3d8 => {
      this.ctx.warn("image-gen", "[剧情百科] 图片生成异常:", _0x3ef3d8);
      _0x14dff3.innerHTML = _0x49d958;
      _0x14dff3.disabled = false;
    }).finally(() => {
      this._processingHashes.delete(_0x3f3828);
      if (this._locationToImageIdMap[_0x3f3828] === "processing") {
        delete this._locationToImageIdMap[_0x3f3828];
      }
    });
  }
  _handleForumInlineButtonClick(_0x5831af, _0x11ba99, _0x10b143) {
    _0x5831af.preventDefault();
    _0x5831af.stopPropagation();
    const _0x521069 = _0x11ba99.dataset.link;
    const _0x4de0f8 = _0x11ba99.dataset.locationHash;
    const _0x642427 = parseInt(_0x11ba99.dataset.matchIndex || "0");
    if (!_0x521069 || !_0x4de0f8) {
      this.ctx.warn("image-gen", "[论坛] 按钮缺少必要的数据属性");
      return;
    }
    this.ctx.log("image-gen", "[论坛] 按钮点击 - link: " + _0x521069.substring(0, 30) + "..., locationHash: " + _0x4de0f8.substring(0, 8) + "...");
    const _0x522792 = this._locationToImageIdMap[_0x4de0f8] === "processing";
    if (_0x522792) {
      this.ctx.helpers.showToast("任务正在处理中...", "info");
      return;
    }
    this._locationToImageIdMap[_0x4de0f8] = "processing";
    _0x11ba99.disabled = true;
    _0x11ba99.innerHTML = "<i class=\"fa-solid fa-spinner fa-spin\"></i> ⏳ 处理中...";
    this.generateFromPrompt(_0x521069, "", {
      locationHash: _0x4de0f8,
      skipInsertToChat: true,
      onStart: () => {
        this.ctx.log("image-gen", "[论坛] 生成开始 - locationHash: " + _0x4de0f8.substring(0, 8) + "...");
      },
      onSuccess: _0x26a2d2 => {
        this.ctx.log("image-gen", "[论坛] 生成成功 - locationHash: " + _0x4de0f8.substring(0, 8) + "..., imageId: " + _0x26a2d2);
        this._locationToImageIdMap[_0x4de0f8] = _0x26a2d2;
        this.scanPhoneForum();
      },
      onError: _0x477ce2 => {
        this.ctx.error("image-gen", "[论坛] 生成失败 - locationHash: " + _0x4de0f8.substring(0, 8) + "...", _0x477ce2);
        delete this._locationToImageIdMap[_0x4de0f8];
        _0x11ba99.disabled = false;
        _0x11ba99.innerHTML = "<i class=\"fa-solid fa-image\"></i> 生成图片";
        this.ctx.helpers.showToast("图片生成失败，请重试", "error");
      }
    });
  }
  _handleMomentsInlineButtonClick(_0x127128, _0xebc6ba, _0xf665ff) {
    _0x127128.preventDefault();
    _0x127128.stopPropagation();
    const _0x3183db = _0xebc6ba.dataset.link;
    const _0x2bdd40 = _0xebc6ba.dataset.locationHash;
    const _0x521117 = parseInt(_0xebc6ba.dataset.matchIndex || "0");
    if (!_0x3183db || !_0x2bdd40) {
      this.ctx.warn("image-gen", "[朋友圈] 按钮缺少必要的数据属性");
      return;
    }
    this.ctx.log("image-gen", "[朋友圈] 按钮点击 - link: " + _0x3183db.substring(0, 30) + "..., locationHash: " + _0x2bdd40.substring(0, 8) + "...");
    const _0x5ddbc3 = this._locationToImageIdMap[_0x2bdd40] === "processing";
    if (_0x5ddbc3) {
      this.ctx.helpers.showToast("任务正在处理中...", "info");
      return;
    }
    this._locationToImageIdMap[_0x2bdd40] = "processing";
    _0xebc6ba.disabled = true;
    _0xebc6ba.innerHTML = "<i class=\"fa-solid fa-spinner fa-spin\"></i> ⏳ 处理中...";
    const _0x159834 = {
      locationHash: _0x2bdd40,
      skipInsertToChat: true,
      skipAiProcessing: false
    };
    this.generateFromPrompt(_0x3183db, "", _0x159834).then(_0x1df794 => {
      if (_0x1df794.queued) {
        this.ctx.helpers.showToast("已加入生成队列", "info");
        _0xebc6ba.innerHTML = "<i class=\"fa-solid fa-clock\"></i> 排队中...";
        return;
      }
      if (_0x1df794.success) {
        this.ctx.helpers.showToast("图片生成成功！", "success");
        setTimeout(() => {
          this.scanPhoneMoments();
        }, 500);
      } else {
        this.ctx.helpers.showToast("图片生成失败", "error");
        _0xebc6ba.disabled = false;
        _0xebc6ba.innerHTML = "<i class=\"fa-solid fa-image\"></i> 生成图片";
        delete this._locationToImageIdMap[_0x2bdd40];
      }
    }).catch(_0x2c9f8e => {
      this.ctx.error("image-gen", "[朋友圈] 生成失败", _0x2c9f8e);
      this.ctx.helpers.showToast("图片生成失败", "error");
      _0xebc6ba.disabled = false;
      _0xebc6ba.innerHTML = "<i class=\"fa-solid fa-image\"></i> 生成图片";
      delete this._locationToImageIdMap[_0x2bdd40];
    });
  }
  _createPhoneGenButtonHtml(_0x2c2f95, _0x4eac80) {
    return "<button class=\"tsp-inline-gen-btn\" data-link=\"" + this._escapeHtml(_0x4eac80) + "\" data-location-hash=\"" + _0x2c2f95 + "\" data-match-index=\"0\" title=\"点击生成图片\">\n            <i class=\"fa-solid fa-image\"></i> 生成图片\n        </button>";
  }
  _escapeHtml(_0xbc982e) {
    const _0x3af8de = document.createElement("div");
    _0x3af8de.textContent = _0xbc982e;
    return _0x3af8de.innerHTML;
  }
  _performStreamingScan() {
    if (this._streamingCount >= this._maxAutoClicks) {
      return;
    }
    const _0x246d79 = document.getElementById("chat");
    if (!_0x246d79) {
      return;
    }
    const _0x112153 = _0x246d79.querySelectorAll(".mes");
    if (_0x112153.length === 0) {
      return;
    }
    const _0x34da4c = _0x112153[_0x112153.length - 1];
    if (!_0x34da4c) {
      return;
    }
    const _0x1cd98d = _0x34da4c.querySelector(".mes_text");
    if (!_0x1cd98d) {
      return;
    }
    let _0x2b4bce = _0x1cd98d.innerHTML || "";
    if (!_0x2b4bce.includes(this._analysisBegins)) {
      return;
    }
    const _0x4c4462 = this._escapeRegex(this._analysisBegins);
    const _0x30bb3c = this._escapeRegex(this._analysisCompleted);
    const _0x1f85e2 = new RegExp(_0x4c4462 + "([\\s\\S]*?)" + _0x30bb3c, "g");
    const _0x10c63f = [..._0x2b4bce.matchAll(_0x1f85e2)];
    if (_0x10c63f.length === 0) {
      return;
    }
    const _0x486546 = _0x34da4c.dataset.mesid || _0x34da4c.getAttribute("mesid") || "";
    const _0x4ef0de = _0x34da4c.dataset.timestamp || _0x34da4c.getAttribute("timestamp") || "";
    const _0x187a1c = _0x34da4c.dataset.chName || _0x34da4c.getAttribute("ch_name") || "";
    const _0x49b987 = _0x4ef0de + "-" + _0x187a1c + "-" + _0x486546;
    _0x10c63f.forEach((_0x4c228f, _0x173d86) => {
      if (this._streamingCount >= this._maxAutoClicks) {
        return;
      }
      const _0xfdfcd8 = _0x4c228f[1].trim();
      const _0x2a0a6d = this._createStableLinkContent(_0xfdfcd8);
      if (this._currentStreamProcessedLinks.has(_0x2a0a6d)) {
        return;
      }
      const _0x29ebea = this._md5(_0x49b987 + "-" + _0x2a0a6d + "-" + _0x173d86);
      if (this._locationToImageIdMap[_0x29ebea]) {
        return;
      }
      this.ctx.log("image-gen", "[流式预加载] 触发新生成: " + _0x29ebea.substring(0, 8) + "... (Link: " + _0x2a0a6d.substring(0, 20) + "...)");
      this._currentStreamProcessedLinks.add(_0x2a0a6d);
      this._locationToImageIdMap[_0x29ebea] = "processing";
      this._processingHashes.add(_0x29ebea);
      this._streamingCount++;
      const _0x7e7767 = {
        locationHash: _0x29ebea,
        skipInsertToChat: true,
        skipAiProcessing: false
      };
      this.generateFromPrompt(_0x2a0a6d, "", _0x7e7767).then(_0x1d5c6e => {
        if (_0x1d5c6e.success) {
          this.ctx.log("image-gen", "[流式预加载] 完成: " + _0x1d5c6e.imageId);
        } else {
          this._currentStreamProcessedLinks.delete(_0x2a0a6d);
        }
      }).catch(_0x461f9a => {
        this.ctx.warn("image-gen", "[流式预加载] 异常:", _0x461f9a);
        this._currentStreamProcessedLinks.delete(_0x2a0a6d);
        this._processingHashes.delete(_0x29ebea);
        if (this._locationToImageIdMap[_0x29ebea] === "processing") {
          delete this._locationToImageIdMap[_0x29ebea];
        }
      });
    });
  }
  async _handleSingleMessageUpdate(_0x8ecd2c) {
    const _0x2a6fa5 = await this.ctx.api.getValue("text2img_enabled", true);
    if (!_0x2a6fa5) {
      return;
    }
    if (_0x8ecd2c === undefined || _0x8ecd2c === null) {
      return;
    }
    const _0x27a586 = document.getElementById("chat");
    if (!_0x27a586) {
      return;
    }
    const _0x3762bf = _0x27a586.querySelector(".mes[mesid=\"" + _0x8ecd2c + "\"]");
    if (_0x3762bf) {
      this.ctx.log("image-gen", "[事件触发] 正在更新消息 ID: " + _0x8ecd2c);
      setTimeout(async () => {
        const _0x4611da = _0x3762bf.querySelector(".mes_text");
        if (_0x4611da) {
          delete _0x4611da.dataset.tspProcessed;
          delete _0x4611da.dataset.tspIframeProcessed;
        }
        const _0x32667a = this.scanAndInjectMessage(_0x3762bf);
        const _0x5155a1 = _0x3762bf.querySelectorAll(".tsp-inline-gen-btn").length;
        this.ctx.log("image-gen", "[消息更新] 消息 ID: " + _0x8ecd2c + " 中共有 " + _0x5155a1 + " 个按钮，重新处理成功 " + _0x32667a.length + " 个");
        if (_0x32667a.length > 0 && this._autoGenerate) {
          this.processAutoClickQueue(_0x32667a);
        }
        this._reloadImagesInMessage(_0x3762bf);
      }, 2000);
    }
  }
  _reloadImagesInMessage(_0xbe2b4f) {
    const _0x371a44 = _0xbe2b4f.querySelectorAll("img.tsp-inline-image[data-is-loaded=\"false\"]");
    if (_0x371a44.length > 0) {
      this.ctx.log("image-gen", "[图片重载] 开始重新加载消息中的 " + _0x371a44.length + " 张图片");
      _0x371a44.forEach(_0x4caaf3 => {
        const _0x2abfb0 = _0x4caaf3.dataset.imageId;
        if (_0x2abfb0) {
          this._observeImage(_0x4caaf3, false);
        }
      });
    }
  }
  scanAndInjectMessage(_0x1fcb13) {
    const _0x3e66d7 = _0x1fcb13.querySelector(".mes_text");
    if (!_0x3e66d7) {
      return [];
    }
    const _0x5f17cd = this._isLikelyCustomFrontend(_0x3e66d7, _0x1fcb13);
    if (_0x5f17cd) {
      const _0x4727b8 = "tspIframeProcessed";
      const _0x3c5674 = parseInt(_0x3e66d7.dataset[_0x4727b8] || "0", 10);
      const _0x3450a1 = Date.now();
      if (_0x3c5674 && _0x3450a1 - _0x3c5674 < 3500) {
        return [];
      }
      const _0x200cb1 = this._scanIframesInMessage(_0x3e66d7, _0x1fcb13);
      _0x3e66d7.dataset[_0x4727b8] = String(_0x3450a1);
      return _0x200cb1;
    }
    let _0x4f2bf0 = _0x3e66d7.innerHTML;
    const _0x35c511 = _0x4f2bf0.includes(this._analysisBegins);
    if (!_0x35c511 && _0x3e66d7.dataset.tspProcessed === "true") {
      return [];
    }
    if (_0x35c511) {
      delete _0x3e66d7.dataset.tspProcessed;
    }
    const _0x325c08 = this._escapeRegex(this._analysisBegins);
    const _0x2b2325 = this._escapeRegex(this._analysisCompleted);
    const _0x14d1c2 = new RegExp(_0x325c08 + "([\\s\\S]*?)" + _0x2b2325, "g");
    const _0x474d82 = [..._0x4f2bf0.matchAll(_0x14d1c2)];
    if (_0x474d82.length === 0) {
      return [];
    }
    const _0x26d6c3 = _0x1fcb13.dataset.mesid || _0x1fcb13.getAttribute("mesid") || "";
    const _0x5e6e44 = _0x1fcb13.dataset.timestamp || _0x1fcb13.getAttribute("timestamp") || "";
    const _0x30bbea = _0x1fcb13.dataset.chName || _0x1fcb13.getAttribute("ch_name") || "";
    const _0x3bfc09 = _0x1fcb13.dataset.uid || _0x1fcb13.getAttribute("data-uid") || _0x1fcb13.id || "";
    const _0x409cb3 = _0x5e6e44 + "-" + _0x30bbea + "-" + _0x26d6c3;
    const _0x2fa795 = [];
    let _0x535816 = 0;
    let _0x3699d0 = _0x4f2bf0;
    const _0x4c2d7b = _0x474d82.slice(-this._maxButtons);
    let _0x35fa63 = 0;
    for (const _0x23ec33 of _0x474d82) {
      const _0x864d66 = _0x23ec33[0];
      const _0x26b827 = _0x23ec33[1].trim();
      if (_0x35fa63 >= _0x4c2d7b.length) {
        _0x35fa63++;
        continue;
      }
      const _0x667b4 = this._createStableLinkContent(_0x26b827);
      const _0x4ee2ef = this._md5(_0x409cb3 + "-" + _0x667b4 + "-" + _0x535816);
      const _0x369763 = [_0x4ee2ef];
      const _0x3bf9e9 = _0x5e6e44 + "-" + _0x26d6c3;
      _0x369763.push(this._md5(_0x3bf9e9 + "-" + _0x667b4 + "-" + _0x535816));
      if (_0x3bfc09) {
        _0x369763.push(this._md5(_0x3bfc09 + "-" + _0x667b4 + "-" + _0x535816));
      }
      if (_0x26d6c3) {
        _0x369763.push(this._md5(_0x26d6c3 + "-" + _0x667b4 + "-" + _0x535816));
      }
      if (_0x5e6e44) {
        _0x369763.push(this._md5(_0x5e6e44 + "-" + _0x667b4 + "-" + _0x535816));
      }
      let _0x1e8004 = null;
      let _0x2299e1 = false;
      for (const _0x568ea6 of _0x369763) {
        const _0x25fad7 = this._locationToImageIdMap[_0x568ea6];
        if (_0x25fad7 === "processing") {
          _0x2299e1 = true;
          if (_0x568ea6 !== _0x4ee2ef) {
            this._locationToImageIdMap[_0x4ee2ef] = "processing";
          }
          break;
        }
        if (_0x25fad7 && _0x25fad7 !== "processing") {
          _0x1e8004 = _0x25fad7;
          if (_0x568ea6 !== _0x4ee2ef) {
            this._locationToImageIdMap[_0x4ee2ef] = _0x25fad7;
          }
          break;
        }
      }
      let _0x2b1c0d;
      if (_0x1e8004 && _0x1e8004 !== "processing") {
        _0x2b1c0d = "<span class=\"tsp-image-slot\" data-location-hash=\"" + _0x4ee2ef + "\" data-image-id=\"" + _0x1e8004 + "\">\n                    <button class=\"tsp-inline-gen-btn tsp-regenerate-btn\"\n                            data-link=\"" + this._escapeHtml(_0x667b4) + "\"\n                            data-location-hash=\"" + _0x4ee2ef + "\"\n                            data-match-index=\"" + _0x535816 + "\"\n                            title=\"重新生成图片\">\n                        生成图片\n                    </button>\n                    <img class=\"tsp-generated-image tsp-inline-image\"\n                         src=\"" + TRANSPARENT_PIXEL + "\"\n                         data-is-loaded=\"false\"\n                         data-image-id=\"" + _0x1e8004 + "\"\n                         data-location-hash=\"" + _0x4ee2ef + "\"\n                         alt=\"图片占位符\"\n                         style=\"max-width:100%; cursor:pointer; border-radius:8px; min-height: 50px; background: rgba(122,162,247,0.1);\">\n                </span>";
      } else if (_0x2299e1) {
        _0x2b1c0d = "<button class=\"tsp-inline-gen-btn\"\n                        data-link=\"" + this._escapeHtml(_0x667b4) + "\"\n                        data-location-hash=\"" + _0x4ee2ef + "\"\n                        data-match-index=\"" + _0x535816 + "\"\n                        disabled=\"true\">\n                    <i class=\"fa-solid fa-spinner fa-spin\"></i> ⏳ 流式处理中...\n                </button>";
      } else {
        _0x2b1c0d = "<button class=\"tsp-inline-gen-btn\" data-link=\"" + this._escapeHtml(_0x667b4) + "\" data-location-hash=\"" + _0x4ee2ef + "\" data-match-index=\"" + _0x535816 + "\" title=\"点击生成图片\">\n                    <i class=\"fa-solid fa-image\"></i> 生成图片\n                </button>";
      }
      const _0x2a21b0 = this._zoomRatio || 100;
      if (this._privacyMode) {
        _0x2b1c0d = "\n                <div class=\"tsp-privacy-container\" style=\"max-width: " + _0x2a21b0 + "%;\">\n                    <div class=\"tsp-privacy-toggle\" data-action=\"toggle-privacy\">\n                        <i class=\"fa-solid fa-eye-slash\"></i> <span>已加密内容 (点击解码)</span>\n                        <i class=\"fa-solid fa-chevron-down tsp-chevron\"></i>\n                    </div>\n                    <div class=\"tsp-privacy-content\">\n                        " + _0x2b1c0d + "\n                    </div>\n                </div>";
      }
      _0x3699d0 = _0x3699d0.replace(_0x864d66, _0x2b1c0d);
      _0x535816++;
      _0x35fa63++;
    }
    const _0x17c3e4 = _0x3e66d7.querySelectorAll("img.tsp-inline-image");
    if (_0x17c3e4.length > 0 && this._visibilityObserver) {
      _0x17c3e4.forEach(_0x36ef24 => {
        this._visibilityObserver.unobserve(_0x36ef24);
      });
    }
    _0x3e66d7.innerHTML = _0x3699d0;
    _0x3e66d7.dataset.tspProcessed = "true";
    addCopyToCodeBlocks(_0x3e66d7);
    const _0xa2c3c9 = _0x3e66d7.querySelectorAll(".tsp-inline-gen-btn");
    _0xa2c3c9.forEach(_0x3d98f9 => {
      const _0x5582c6 = _0x3d98f9;
      if (!_0x5582c6.dataset.bound) {
        _0x5582c6.dataset.bound = "true";
        _0x5582c6.addEventListener("click", _0x530d8a => this._handleInlineButtonClick(_0x530d8a, _0x5582c6, _0x1fcb13));
        _0x2fa795.push(_0x5582c6);
      }
    });
    const _0x1aeac8 = _0x3e66d7.querySelectorAll(".tsp-privacy-toggle[data-action=\"toggle-privacy\"]");
    _0x1aeac8.forEach(_0x2b5b3a => {
      if (!_0x2b5b3a.dataset.bound) {
        _0x2b5b3a.dataset.bound = "true";
        _0x2b5b3a.addEventListener("click", function () {
          const _0x3b73d9 = this.parentElement;
          if (_0x3b73d9) {
            _0x3b73d9.classList.toggle("expanded");
          }
        });
      }
    });
    const _0x40ae28 = _0x3e66d7.querySelectorAll("img.tsp-inline-image[data-is-loaded=\"false\"]");
    if (_0x40ae28.length > 0) {
      requestAnimationFrame(() => {
        _0x40ae28.forEach(_0x19d4ad => {
          this._observeImage(_0x19d4ad, false);
          const _0x265fc2 = _0x19d4ad.dataset.imageId;
          if (_0x265fc2) {
            setTimeout(async () => {
              if (_0x19d4ad.dataset.isLoaded !== "true") {
                const _0x183ac9 = _0x19d4ad.getBoundingClientRect();
                const _0x21f4a0 = _0x183ac9.bottom > -1500 && _0x183ac9.top < window.innerHeight + 1500;
                if (_0x21f4a0) {
                  try {
                    const _0x76d016 = await this.getCachedImage(parseInt(_0x265fc2));
                    if (_0x76d016) {
                      const _0x1c9c21 = () => {
                        _0x19d4ad.style.height = "auto";
                        _0x19d4ad.style.minHeight = "";
                        _0x19d4ad.onload = null;
                      };
                      _0x19d4ad.onload = _0x1c9c21;
                      if (_0x76d016.serverPath) {
                        _0x19d4ad.src = _0x76d016.serverPath;
                      } else if (_0x76d016.imageData) {
                        if (_0x19d4ad.src.startsWith("blob:")) {
                          URL.revokeObjectURL(_0x19d4ad.src);
                        }
                        if (_0x76d016.imageData instanceof Blob) {
                          _0x19d4ad.src = URL.createObjectURL(_0x76d016.imageData);
                        } else {
                          const _0x512558 = this._dataURLtoBlob(_0x76d016.imageData);
                          _0x19d4ad.src = _0x512558 ? URL.createObjectURL(_0x512558) : _0x76d016.imageData;
                        }
                      }
                      _0x19d4ad.dataset.isLoaded = "true";
                      if (_0x19d4ad.ownerDocument === document && this.interactionManager) {
                        this.interactionManager.addSmartClickHandler(_0x19d4ad);
                      }
                    }
                  } catch (_0x144bd2) {}
                }
              }
            }, 500);
          }
        });
      });
    }
    return _0x2fa795;
  }
  async _handleInlineButtonClick(_0x291bf2, _0x599c0c, _0x40ea7c) {
    _0x291bf2.preventDefault();
    _0x291bf2.stopPropagation();
    const _0x2e9b7f = _0x599c0c.dataset.link || "";
    const _0x3228dd = _0x599c0c.dataset.locationHash || "";
    if (!_0x3228dd || !_0x2e9b7f) {
      this.ctx.helpers.showToast("按钮数据无效", "error");
      return;
    }
    if (this._processingHashes.has(_0x3228dd)) {
      this.ctx.helpers.showToast("该图片正在生成队列中...", "info");
      return;
    }
    if (this._locationToImageIdMap[_0x3228dd] === "processing") {
      this.ctx.helpers.showToast("该图片正在流式生成中，请稍候...", "info");
      this._updateButtonStatus(_0x599c0c, "loading", "⏳ 流式加载中...");
      return;
    }
    if (this._aiProcessingHashes.has(_0x3228dd)) {
      this.ctx.helpers.showToast("该按钮的AI请求已发出，请稍候...", "info");
      return;
    }
    this._aiProcessingHashes.add(_0x3228dd);
    const _0x59369a = this.ctx.getModule("aiProcessor");
    try {
      if (_0x59369a) {
        await _0x59369a.findAndStoreStoryContext(_0x599c0c);
      }
      let _0x529486 = _0x2e9b7f;
      if (_0x59369a) {
        const _0x192571 = _0x59369a.lastStoryContext;
        if (_0x59369a.isBatchingEnabled()) {
          this._updateButtonStatus(_0x599c0c, "loading", "⏳ 已加入批量队列...");
          const _0x2e9ece = _0x599c0c.id || "";
          const _0x4b78ed = _0x40ea7c || _0x599c0c.closest(".mes") || document.body;
          const _0xc3e08c = _0x4b78ed.querySelectorAll(".tsp-inline-gen-btn");
          const _0x51c21e = Array.from(_0xc3e08c).indexOf(_0x599c0c);
          const _0xba70ea = _0x51c21e === 0;
          const _0x31d03f = _0x51c21e === _0xc3e08c.length - 1;
          _0x529486 = await _0x59369a.addToBatchQueue(_0x2e9b7f, _0x192571, _0x3228dd, _0x2e9ece, _0xba70ea, _0x31d03f);
          this.ctx.log("image-gen", "批量任务已返回结果: " + _0x3228dd.substring(0, 8));
        } else {
          this._updateButtonStatus(_0x599c0c, "loading", "🤖 AI处理中...");
          _0x529486 = await _0x59369a.processPromptWithAI(_0x2e9b7f);
        }
      }
      if (!_0x529486 || typeof _0x529486 !== "string") {
        throw new Error("AI未返回有效提示词。");
      }
      this._updateButtonStatus(_0x599c0c, "loading", "✅ 排队中...");
      const _0x390a24 = {
        locationHash: _0x3228dd,
        buttonEl: _0x599c0c,
        skipInsertToChat: true,
        skipAiProcessing: true
      };
      await this.generateFromPrompt(_0x529486, "", _0x390a24);
    } catch (_0x58f24a) {
      this.ctx.error("image-gen", "处理失败:", _0x58f24a);
      this.ctx.helpers.showToast("处理失败: " + _0x58f24a.message, "error");
      this._updateButtonStatus(_0x599c0c, "default");
      this._processingHashes.delete(_0x3228dd);
    } finally {
      this._aiProcessingHashes.delete(_0x3228dd);
    }
  }
  _displayImageAtButton(_0x5df62b, _0x442fb6, _0x48bb23, _0x52f17a) {
    this._locationToImageIdMap[_0x52f17a] = _0x48bb23;
    const _0xd32de4 = _0x5df62b.closest(".tsp-phone-message-content");
    const _0x32af41 = !!_0xd32de4;
    const _0x45a148 = _0x5df62b.closest(".tsp-phone-post-card");
    const _0x1a7820 = !!_0x45a148;
    const _0x3f5603 = _0x5df62b.ownerDocument || document;
    const _0x890ad4 = this._zoomRatio || 100;
    let _0xabf1bb;
    const _0x148c2e = !_0x442fb6;
    const _0x5e0cc0 = !_0x148c2e && this._isVideoContent(_0x442fb6);
    if (_0x5e0cc0) {
      _0xabf1bb = _0x3f5603.createElement("video");
      _0xabf1bb.controls = true;
      _0xabf1bb.autoplay = true;
      _0xabf1bb.loop = true;
      _0xabf1bb.muted = true;
      _0xabf1bb.playsInline = true;
      _0xabf1bb.style.objectFit = "contain";
      _0xabf1bb.src = _0x442fb6;
    } else {
      _0xabf1bb = _0x3f5603.createElement("img");
      _0xabf1bb.alt = "生成的图片";
      if (!_0x148c2e) {
        if (_0x442fb6 instanceof Blob) {
          _0xabf1bb.src = URL.createObjectURL(_0x442fb6);
        } else if (typeof _0x442fb6 === "string" && _0x442fb6.startsWith("data:image")) {
          const _0x545d97 = this._dataURLtoBlob(_0x442fb6);
          if (_0x545d97) {
            _0xabf1bb.src = URL.createObjectURL(_0x545d97);
          } else {
            _0xabf1bb.src = _0x442fb6;
          }
        } else {
          _0xabf1bb.src = _0x442fb6;
        }
      } else {
        _0xabf1bb.src = TRANSPARENT_PIXEL;
      }
    }
    _0xabf1bb.className = _0x1a7820 ? "tsp-generated-image tsp-moments-image" : "tsp-generated-image tsp-inline-image";
    _0xabf1bb.dataset.imageId = String(_0x48bb23);
    _0xabf1bb.dataset.locationHash = _0x52f17a;
    _0xabf1bb.dataset.isLoaded = _0x148c2e ? "false" : "true";
    if (_0x1a7820) {
      _0xabf1bb.style.cssText = "max-width:100%; max-height:400px; cursor:pointer; border-radius:8px; min-height: 50px; background: rgba(122,162,247,0.1);";
    } else if (_0x32af41) {
      _0xabf1bb.style.cssText = "max-width: 200px; max-height: 200px; cursor: pointer; border-radius: 8px; margin: 4px 0; min-height: 50px; background: rgba(122,162,247,0.1);";
    } else {
      _0xabf1bb.style.cssText = "max-width: " + _0x890ad4 + "%; cursor: pointer; border-radius: 5px; margin: 0; min-height: 50px; background: rgba(122,162,247,0.1);";
    }
    if (!_0x32af41 && !_0x1a7820) {
      this._observeImage(_0xabf1bb, !_0x148c2e);
    }
    if (this.interactionManager && _0x3f5603 === document) {
      this.interactionManager.addSmartClickHandler(_0xabf1bb);
    }
    this._updateButtonStatus(_0x5df62b, "default", "生成图片");
    _0x5df62b.classList.add("tsp-regenerate-btn");
    _0x5df62b.title = "点击重新生成";
    if (_0x5df62b.parentElement && _0x5df62b.parentElement.classList.contains("tsp-image-slot") || _0x5df62b.parentElement && _0x5df62b.parentElement.classList.contains("tsp-moments-image-slot")) {
      const _0x5f2d42 = _0x5df62b.parentElement;
      _0x5f2d42.dataset.imageId = String(_0x48bb23);
      const _0x4d24ec = _0x5f2d42.querySelector(".tsp-inline-image, .tsp-moments-image");
      if (_0x4d24ec) {
        _0x4d24ec.remove();
      }
      _0x5f2d42.appendChild(_0xabf1bb);
    } else if (_0x5df62b.parentElement) {
      const _0xf248bc = _0x3f5603.createElement(_0x1a7820 ? "div" : "span");
      _0xf248bc.className = _0x1a7820 ? "tsp-moments-image-slot" : "tsp-image-slot";
      _0xf248bc.dataset.locationHash = _0x52f17a;
      _0xf248bc.dataset.imageId = String(_0x48bb23);
      _0x5df62b.parentElement.insertBefore(_0xf248bc, _0x5df62b);
      _0xf248bc.appendChild(_0x5df62b);
      _0xf248bc.appendChild(_0xabf1bb);
    }
    if (!_0x32af41 && !_0x1a7820) {
      if (!_0x148c2e) {
        requestAnimationFrame(() => {
          this._observeImage(_0xabf1bb, true);
        });
      } else {
        this._observeImage(_0xabf1bb, false);
      }
    }
  }
  processAutoClickQueue(_0x12035c) {
    if (this._isCharacterSwitching) {
      this.ctx.log("image-gen", "自动点击跳过 (正在切换角色卡)");
      return;
    }
    if (this._isSyncingUI) {
      this.ctx.log("image-gen", "自动点击跳过 (正在同步 UI)");
      return;
    }
    if (!this._autoGenerate || _0x12035c.length === 0) {
      return;
    }
    const _0x508ad2 = _0x12035c.filter(_0xd8d2 => {
      return !_0xd8d2.classList.contains("tsp-regenerate-btn");
    });
    if (_0x508ad2.length === 0) {
      return;
    }
    const _0x13dc40 = _0x508ad2.filter(_0x5adeac => {
      const _0x59174b = _0x5adeac.dataset.locationHash;
      const _0x9c5339 = this._processingHashes.has(_0x59174b) || this._streamingProcessedHashes.has(_0x59174b) || this._locationToImageIdMap[_0x59174b];
      if (_0x9c5339) {
        this.ctx.log("image-gen", "自动点击跳过 (已在处理/已完成): " + _0x59174b?.substring(0, 8));
      }
      return _0x59174b && !_0x9c5339;
    });
    const _0x2ae12a = _0x13dc40.slice(0, this._maxAutoClicks);
    this.ctx.log("image-gen", "自动点击队列：找到 " + _0x13dc40.length + " 个新按钮，处理前 " + _0x2ae12a.length + " 个。");
    _0x2ae12a.forEach(_0x56e577 => {
      if (_0x56e577.isConnected && !_0x56e577.disabled) {
        this.ctx.log("image-gen", "执行自动点击: " + _0x56e577.dataset.locationHash);
        _0x56e577.click();
      }
    });
  }
  async _loadCachedImageForSlot(_0x51f9f4, _0x4fd2c8) {
    try {
      const _0x8399a6 = await this.getCachedImage(_0x4fd2c8);
      if (_0x8399a6 && (_0x8399a6.imageData || _0x8399a6.serverPath)) {
        let _0x23f8f4 = document.querySelector(".tsp-image-slot[data-location-hash=\"" + _0x51f9f4 + "\"]");
        if (!_0x23f8f4) {
          const _0x2215f7 = document.querySelectorAll("iframe");
          for (const _0x1c8af4 of _0x2215f7) {
            try {
              const _0x18e297 = _0x1c8af4.contentDocument || _0x1c8af4.contentWindow?.document;
              if (_0x18e297) {
                _0x23f8f4 = _0x18e297.querySelector(".tsp-image-slot[data-location-hash=\"" + _0x51f9f4 + "\"]");
                if (_0x23f8f4) {
                  break;
                }
              }
            } catch (_0x4c7cb7) {}
          }
        }
        if (_0x23f8f4) {
          let _0x46e9cd;
          let _0xa40b25 = false;
          if (_0x8399a6.imageData) {
            _0xa40b25 = this._isVideoContent(_0x8399a6.imageData);
          } else if (_0x8399a6.serverPath && typeof _0x8399a6.serverPath === "string") {
            _0xa40b25 = _0x8399a6.serverPath.toLowerCase().endsWith(".mp4") || _0x8399a6.serverPath.toLowerCase().endsWith(".webm");
          }
          if (_0xa40b25) {
            _0x46e9cd = document.createElement("video");
            _0x46e9cd.controls = true;
            _0x46e9cd.autoplay = true;
            _0x46e9cd.loop = true;
            _0x46e9cd.muted = true;
            _0x46e9cd.playsInline = true;
            _0x46e9cd.style.objectFit = "contain";
          } else {
            _0x46e9cd = document.createElement("img");
            _0x46e9cd.alt = "生成的图片";
          }
          _0x46e9cd.className = "tsp-generated-image tsp-inline-image";
          if (_0x8399a6.serverPath) {
            _0x46e9cd.src = _0x8399a6.serverPath;
          } else if (_0x8399a6.imageData) {
            if (_0x8399a6.imageData instanceof Blob) {
              _0x46e9cd.src = URL.createObjectURL(_0x8399a6.imageData);
            } else {
              const _0x13a87f = this._dataURLtoBlob(_0x8399a6.imageData);
              _0x46e9cd.src = _0x13a87f ? URL.createObjectURL(_0x13a87f) : _0x8399a6.imageData;
            }
          } else {
            _0x46e9cd.src = TRANSPARENT_PIXEL;
          }
          _0x46e9cd.dataset.imageId = String(_0x4fd2c8);
          _0x46e9cd.dataset.locationHash = _0x51f9f4;
          const _0x212e10 = this._zoomRatio || 100;
          _0x46e9cd.style.cssText = "max-width: " + _0x212e10 + "%; cursor: pointer; border-radius: 8px; margin: 0; min-height: 50px; background: rgba(122,162,247,0.1);";
          const _0x40a463 = _0x23f8f4.querySelector(".tsp-inline-image");
          if (_0x40a463) {
            _0x23f8f4.replaceChild(_0x46e9cd, _0x40a463);
          } else {
            _0x23f8f4.appendChild(_0x46e9cd);
          }
          requestAnimationFrame(() => {
            this._observeImage(_0x46e9cd, true);
          });
        }
      }
    } catch (_0x3ae52b) {
      this.ctx.error("image-gen", "加载缓存图片失败:", _0x3ae52b);
    }
  }
  _openLightbox(_0x20a613) {
    const _0x50d92c = _0x20a613.src;
    if (!_0x50d92c) {
      return;
    }
    const _0x10a65e = document.createElement("div");
    _0x10a65e.className = "tsp-lightbox-overlay";
    _0x10a65e.innerHTML = "\n            <div class=\"tsp-lightbox-content\">\n                <img src=\"" + _0x50d92c + "\" class=\"tsp-lightbox-image\" alt=\"预览\">\n                <button class=\"tsp-lightbox-close\"><i class=\"fa-solid fa-times\"></i></button>\n            </div>\n        ";
    _0x10a65e.addEventListener("click", _0x18cf74 => {
      const _0x5f0fdf = _0x18cf74.target;
      if (_0x5f0fdf === _0x10a65e || _0x5f0fdf.closest?.(".tsp-lightbox-close")) {
        _0x10a65e.remove();
      }
    });
    document.body.appendChild(_0x10a65e);
    requestAnimationFrame(() => _0x10a65e.classList.add("visible"));
  }
  _createStableLinkContent(_0x2a3330) {
    let _0x50cb4d = _0x2a3330;
    _0x50cb4d = _0x50cb4d.replace(/[\r\n]+/g, ", ");
    _0x50cb4d = _0x50cb4d.replace(/<br\s*\/?>/gi, ", ");
    _0x50cb4d = _0x50cb4d.replace(/<[^>]+>/g, "");
    _0x50cb4d = _0x50cb4d.replace(/《/g, "<");
    _0x50cb4d = _0x50cb4d.replace(/》/g, ">");
    _0x50cb4d = _0x50cb4d.replace(/，/g, ",");
    _0x50cb4d = _0x50cb4d.replace(/\s*,\s*/g, ", ");
    _0x50cb4d = _0x50cb4d.replace(/\s+/g, " ").trim();
    return _0x50cb4d;
  }
  _md5(_0x2a424c) {
    function _0x4a9ddb(_0x392bd8, _0x4d31d7) {
      return _0x392bd8 << _0x4d31d7 | _0x392bd8 >>> 32 - _0x4d31d7;
    }
    function _0x4ccfcf(_0x2a9121, _0x57a3e4) {
      const _0x38c6c9 = _0x2a9121 & -2147483648;
      const _0x199066 = _0x57a3e4 & -2147483648;
      const _0x534ce9 = _0x2a9121 & 1073741824;
      const _0x3bf640 = _0x57a3e4 & 1073741824;
      const _0x2e6ade = (_0x2a9121 & 1073741823) + (_0x57a3e4 & 1073741823);
      if (_0x534ce9 & _0x3bf640) {
        return _0x2e6ade ^ -2147483648 ^ _0x38c6c9 ^ _0x199066;
      }
      if (_0x534ce9 | _0x3bf640) {
        if (_0x2e6ade & 1073741824) {
          return _0x2e6ade ^ -1073741824 ^ _0x38c6c9 ^ _0x199066;
        }
        return _0x2e6ade ^ 1073741824 ^ _0x38c6c9 ^ _0x199066;
      }
      return _0x2e6ade ^ _0x38c6c9 ^ _0x199066;
    }
    function _0x1aaf9b(_0x12f2f6) {
      _0x12f2f6 = _0x12f2f6.replace(/\r\n/g, "\n");
      let _0x391376 = "";
      for (let _0x2bd867 = 0; _0x2bd867 < _0x12f2f6.length; _0x2bd867++) {
        const _0x42ed30 = _0x12f2f6.charCodeAt(_0x2bd867);
        if (_0x42ed30 < 128) {
          _0x391376 += String.fromCharCode(_0x42ed30);
        } else if (_0x42ed30 > 127 && _0x42ed30 < 2048) {
          _0x391376 += String.fromCharCode(_0x42ed30 >> 6 | 192);
          _0x391376 += String.fromCharCode(_0x42ed30 & 63 | 128);
        } else {
          _0x391376 += String.fromCharCode(_0x42ed30 >> 12 | 224);
          _0x391376 += String.fromCharCode(_0x42ed30 >> 6 & 63 | 128);
          _0x391376 += String.fromCharCode(_0x42ed30 & 63 | 128);
        }
      }
      return _0x391376;
    }
    function _0x1c4f24(_0x3d7499) {
      let _0x2a0878 = "";
      for (let _0x172602 = 0; _0x172602 <= 3; _0x172602++) {
        const _0x464ab4 = _0x3d7499 >>> _0x172602 * 8 & 255;
        _0x2a0878 += ("0" + _0x464ab4.toString(16)).slice(-2);
      }
      return _0x2a0878;
    }
    const _0x24fa52 = [];
    const _0x447479 = 7;
    const _0x345512 = 12;
    const _0x57f40a = 17;
    const _0x8435a4 = 22;
    const _0x4b2559 = 5;
    const _0x521ab5 = 9;
    const _0x415f13 = 14;
    const _0x259800 = 20;
    const _0x30e5c8 = 4;
    const _0x47569b = 11;
    const _0x2459bd = 16;
    const _0x33d01c = 23;
    const _0x484a36 = 6;
    const _0x1d3601 = 10;
    const _0x1a77f1 = 15;
    const _0x3f93d0 = 21;
    _0x2a424c = _0x1aaf9b(_0x2a424c);
    const _0x17a7e5 = _0x2a424c.length;
    const _0xee148e = [];
    for (let _0x1631ed = 0; _0x1631ed < _0x17a7e5; _0x1631ed++) {
      _0xee148e[_0x1631ed >> 2] |= _0x2a424c.charCodeAt(_0x1631ed) << _0x1631ed % 4 * 8;
    }
    _0xee148e[_0x17a7e5 >> 2] |= 128 << _0x17a7e5 % 4 * 8;
    const _0x5d3bf1 = ((_0x17a7e5 + 8 >>> 6) + 1) * 16;
    for (let _0x577ff9 = _0xee148e.length; _0x577ff9 < _0x5d3bf1 - 2; _0x577ff9++) {
      _0xee148e[_0x577ff9] = 0;
    }
    _0xee148e[_0x5d3bf1 - 2] = _0x17a7e5 * 8;
    _0xee148e[_0x5d3bf1 - 1] = 0;
    let _0x273934 = 1732584193;
    let _0x35b2ab = 4023233417;
    let _0x26810a = 2562383102;
    let _0x567608 = 271733878;
    function _0x2e9d6b(_0x52cd0b, _0x54fb69, _0x29fefd) {
      return _0x52cd0b & _0x54fb69 | ~_0x52cd0b & _0x29fefd;
    }
    function _0x414642(_0x26b7cb, _0x252e57, _0x12fcdb) {
      return _0x26b7cb & _0x12fcdb | _0x252e57 & ~_0x12fcdb;
    }
    function _0x4ee98f(_0x2b8258, _0x3119f1, _0x3086b9) {
      return _0x2b8258 ^ _0x3119f1 ^ _0x3086b9;
    }
    function _0x5c3b0f(_0x4f9a33, _0x2fa03e, _0x1130a2) {
      return _0x2fa03e ^ (_0x4f9a33 | ~_0x1130a2);
    }
    function _0x573d29(_0x4490d8, _0x37c936, _0x2e12e4, _0x5c3f59, _0x2c82b2, _0x39c4c1, _0x44e6ac) {
      _0x4490d8 = _0x4ccfcf(_0x4490d8, _0x4ccfcf(_0x4ccfcf(_0x2e9d6b(_0x37c936, _0x2e12e4, _0x5c3f59), _0x2c82b2), _0x44e6ac));
      return _0x4ccfcf(_0x4a9ddb(_0x4490d8, _0x39c4c1), _0x37c936);
    }
    function _0x3fa329(_0x1c5b68, _0x4b0be5, _0x418013, _0x2d0f3e, _0x6ebdf4, _0x5450d4, _0x51a701) {
      _0x1c5b68 = _0x4ccfcf(_0x1c5b68, _0x4ccfcf(_0x4ccfcf(_0x414642(_0x4b0be5, _0x418013, _0x2d0f3e), _0x6ebdf4), _0x51a701));
      return _0x4ccfcf(_0x4a9ddb(_0x1c5b68, _0x5450d4), _0x4b0be5);
    }
    function _0x5dd6c8(_0x290479, _0x4cefc2, _0x418493, _0x40bdd9, _0x2312ce, _0xc86ac0, _0x4040e8) {
      _0x290479 = _0x4ccfcf(_0x290479, _0x4ccfcf(_0x4ccfcf(_0x4ee98f(_0x4cefc2, _0x418493, _0x40bdd9), _0x2312ce), _0x4040e8));
      return _0x4ccfcf(_0x4a9ddb(_0x290479, _0xc86ac0), _0x4cefc2);
    }
    function _0x4d55fe(_0x3780ef, _0x2666b9, _0x1348f7, _0x287101, _0x107b74, _0x3e3412, _0x2eb93b) {
      _0x3780ef = _0x4ccfcf(_0x3780ef, _0x4ccfcf(_0x4ccfcf(_0x5c3b0f(_0x2666b9, _0x1348f7, _0x287101), _0x107b74), _0x2eb93b));
      return _0x4ccfcf(_0x4a9ddb(_0x3780ef, _0x3e3412), _0x2666b9);
    }
    for (let _0x2cac19 = 0; _0x2cac19 < _0x5d3bf1; _0x2cac19 += 16) {
      const _0x12ae8f = _0x273934;
      const _0x194c98 = _0x35b2ab;
      const _0x2d3ce7 = _0x26810a;
      const _0x36d095 = _0x567608;
      _0x273934 = _0x573d29(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19], _0x447479, 3614090360);
      _0x567608 = _0x573d29(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 1], _0x345512, 3905402710);
      _0x26810a = _0x573d29(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 2], _0x57f40a, 606105819);
      _0x35b2ab = _0x573d29(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 3], _0x8435a4, 3250441966);
      _0x273934 = _0x573d29(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19 + 4], _0x447479, 4118548399);
      _0x567608 = _0x573d29(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 5], _0x345512, 1200080426);
      _0x26810a = _0x573d29(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 6], _0x57f40a, 2821735955);
      _0x35b2ab = _0x573d29(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 7], _0x8435a4, 4249261313);
      _0x273934 = _0x573d29(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19 + 8], _0x447479, 1770035416);
      _0x567608 = _0x573d29(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 9], _0x345512, 2336552879);
      _0x26810a = _0x573d29(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 10], _0x57f40a, 4294925233);
      _0x35b2ab = _0x573d29(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 11], _0x8435a4, 2304563134);
      _0x273934 = _0x573d29(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19 + 12], _0x447479, 1804603682);
      _0x567608 = _0x573d29(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 13], _0x345512, 4254626195);
      _0x26810a = _0x573d29(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 14], _0x57f40a, 2792965006);
      _0x35b2ab = _0x573d29(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 15], _0x8435a4, 1236535329);
      _0x273934 = _0x3fa329(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19 + 1], _0x4b2559, 4129170786);
      _0x567608 = _0x3fa329(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 6], _0x521ab5, 3225465664);
      _0x26810a = _0x3fa329(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 11], _0x415f13, 643717713);
      _0x35b2ab = _0x3fa329(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19], _0x259800, 3921069994);
      _0x273934 = _0x3fa329(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19 + 5], _0x4b2559, 3593408605);
      _0x567608 = _0x3fa329(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 10], _0x521ab5, 38016083);
      _0x26810a = _0x3fa329(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 15], _0x415f13, 3634488961);
      _0x35b2ab = _0x3fa329(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 4], _0x259800, 3889429448);
      _0x273934 = _0x3fa329(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19 + 9], _0x4b2559, 568446438);
      _0x567608 = _0x3fa329(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 14], _0x521ab5, 3275163606);
      _0x26810a = _0x3fa329(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 3], _0x415f13, 4107603335);
      _0x35b2ab = _0x3fa329(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 8], _0x259800, 1163531501);
      _0x273934 = _0x3fa329(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19 + 13], _0x4b2559, 2850285829);
      _0x567608 = _0x3fa329(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 2], _0x521ab5, 4243563512);
      _0x26810a = _0x3fa329(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 7], _0x415f13, 1735328473);
      _0x35b2ab = _0x3fa329(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 12], _0x259800, 2368359562);
      _0x273934 = _0x5dd6c8(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19 + 5], _0x30e5c8, 4294588738);
      _0x567608 = _0x5dd6c8(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 8], _0x47569b, 2272392833);
      _0x26810a = _0x5dd6c8(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 11], _0x2459bd, 1839030562);
      _0x35b2ab = _0x5dd6c8(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 14], _0x33d01c, 4259657740);
      _0x273934 = _0x5dd6c8(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19 + 1], _0x30e5c8, 2763975236);
      _0x567608 = _0x5dd6c8(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 4], _0x47569b, 1272893353);
      _0x26810a = _0x5dd6c8(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 7], _0x2459bd, 4139469664);
      _0x35b2ab = _0x5dd6c8(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 10], _0x33d01c, 3200236656);
      _0x273934 = _0x5dd6c8(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19 + 13], _0x30e5c8, 681279174);
      _0x567608 = _0x5dd6c8(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19], _0x47569b, 3936430074);
      _0x26810a = _0x5dd6c8(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 3], _0x2459bd, 3572445317);
      _0x35b2ab = _0x5dd6c8(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 6], _0x33d01c, 76029189);
      _0x273934 = _0x5dd6c8(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19 + 9], _0x30e5c8, 3654602809);
      _0x567608 = _0x5dd6c8(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 12], _0x47569b, 3873151461);
      _0x26810a = _0x5dd6c8(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 15], _0x2459bd, 530742520);
      _0x35b2ab = _0x5dd6c8(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 2], _0x33d01c, 3299628645);
      _0x273934 = _0x4d55fe(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19], _0x484a36, 4096336452);
      _0x567608 = _0x4d55fe(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 7], _0x1d3601, 1126891415);
      _0x26810a = _0x4d55fe(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 14], _0x1a77f1, 2878612391);
      _0x35b2ab = _0x4d55fe(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 5], _0x3f93d0, 4237533241);
      _0x273934 = _0x4d55fe(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19 + 12], _0x484a36, 1700485571);
      _0x567608 = _0x4d55fe(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 3], _0x1d3601, 2399980690);
      _0x26810a = _0x4d55fe(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 10], _0x1a77f1, 4293915773);
      _0x35b2ab = _0x4d55fe(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 1], _0x3f93d0, 2240044497);
      _0x273934 = _0x4d55fe(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19 + 8], _0x484a36, 1873313359);
      _0x567608 = _0x4d55fe(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 15], _0x1d3601, 4264355552);
      _0x26810a = _0x4d55fe(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 6], _0x1a77f1, 2734768916);
      _0x35b2ab = _0x4d55fe(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 13], _0x3f93d0, 1309151649);
      _0x273934 = _0x4d55fe(_0x273934, _0x35b2ab, _0x26810a, _0x567608, _0xee148e[_0x2cac19 + 4], _0x484a36, 4149444226);
      _0x567608 = _0x4d55fe(_0x567608, _0x273934, _0x35b2ab, _0x26810a, _0xee148e[_0x2cac19 + 11], _0x1d3601, 3174756917);
      _0x26810a = _0x4d55fe(_0x26810a, _0x567608, _0x273934, _0x35b2ab, _0xee148e[_0x2cac19 + 2], _0x1a77f1, 718787259);
      _0x35b2ab = _0x4d55fe(_0x35b2ab, _0x26810a, _0x567608, _0x273934, _0xee148e[_0x2cac19 + 9], _0x3f93d0, 3951481745);
      _0x273934 = _0x4ccfcf(_0x273934, _0x12ae8f);
      _0x35b2ab = _0x4ccfcf(_0x35b2ab, _0x194c98);
      _0x26810a = _0x4ccfcf(_0x26810a, _0x2d3ce7);
      _0x567608 = _0x4ccfcf(_0x567608, _0x36d095);
    }
    return _0x1c4f24(_0x273934) + _0x1c4f24(_0x35b2ab) + _0x1c4f24(_0x26810a) + _0x1c4f24(_0x567608);
  }
  _escapeRegex(_0x352097) {
    return _0x352097.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  _escapeHtml(_0x4b5814) {
    return _0x4b5814.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  async injectGenerateButton(_0x360a4d) {
    const _0x56ca88 = await this.ctx.api.getValue("inject_buttons_enabled", true);
    if (!_0x56ca88) {
      return;
    }
    if (_0x360a4d.querySelector(".tsp-gen-container")) {
      return;
    }
    const _0x250a0a = _0x360a4d.querySelector(".mes_buttons") || _0x360a4d.querySelector(".mes_block");
    if (!_0x250a0a) {
      return;
    }
    const _0x4629a5 = document.createElement("div");
    _0x4629a5.className = "tsp-gen-container mes_button";
    _0x4629a5.style.display = "inline-flex";
    _0x4629a5.style.gap = "5px";
    const _0x405824 = document.createElement("div");
    _0x405824.className = "tsp-gen-btn";
    _0x405824.innerHTML = "<i class=\"fa-solid fa-image\"></i>";
    _0x405824.title = "使用当前提示词生成图像";
    _0x405824.style.cursor = "pointer";
    _0x405824.addEventListener("click", async _0xe37c89 => {
      _0xe37c89.stopPropagation();
      const _0x1b86bc = _0x360a4d.querySelector(".mes_text")?.textContent || "";
      const _0x363ee7 = this.ctx.promptBuilder;
      if (_0x363ee7 && _0x363ee7.hasContent()) {
        await _0x363ee7.submitToGenerator();
      } else if (_0x1b86bc) {
        await this.generateFromContext(_0x1b86bc);
      } else {
        this.ctx.helpers.showToast("请先选择标签或提供上下文", "warning");
      }
    });
    const _0x3d9e17 = document.createElement("div");
    _0x3d9e17.className = "tsp-ai-gen-btn";
    _0x3d9e17.innerHTML = "<i class=\"fa-solid fa-wand-magic-sparkles\"></i>";
    _0x3d9e17.title = "AI 提取当前上下文并插入图片";
    _0x3d9e17.style.cursor = "pointer";
    _0x3d9e17.addEventListener("click", async _0x35eced => {
      _0x35eced.stopPropagation();
      const _0x3c0feb = this.ctx.getModule("aiProcessor");
      if (!_0x3c0feb) {
        this.ctx.helpers.showToast("AI 处理器未就绪", "error");
        return;
      }
      if (!_0x360a4d.isConnected) {
        this.ctx.helpers.showToast("该消息似乎已被删除，操作取消", "error");
        return;
      }
      const _0x41d03d = _0x3d9e17.innerHTML;
      _0x3d9e17.innerHTML = "<i class=\"fa-solid fa-spinner fa-spin\"></i>";
      _0x3d9e17.style.pointerEvents = "none";
      try {
        const _0x2ecf70 = _0x3c0feb.getChatInsertionContext(_0x360a4d);
        if (!_0x2ecf70) {
          this.ctx.helpers.showToast("未获取到聊天上下文，请检查楼层设置", "warning");
          return;
        }
        this.ctx.helpers.showToast("正在分析聊天内容，请稍候...", "info");
        const _0x252ab8 = await _0x3c0feb.processChatInsertionWithAI(_0x2ecf70);
        let _0x377313 = "";
        let _0xf12a58 = false;
        if (_0x252ab8 && typeof _0x252ab8 === "object" && _0x252ab8.type === "REPLACE") {
          _0x377313 = _0x252ab8.content;
          _0xf12a58 = true;
        } else if (typeof _0x252ab8 === "string") {
          _0x377313 = _0x252ab8;
          _0xf12a58 = false;
        }
        if (_0x377313) {
          if (!_0x360a4d.isConnected) {
            throw new Error("消息元素已从页面移除，无法插入内容。");
          }
          const _0x2a6a31 = _0x360a4d.getAttribute("mesid");
          if (!chat || !chat[_0x2a6a31]) {
            throw new Error("找不到对应的聊天记录索引 (" + _0x2a6a31 + ")，可能已被删除或清除。");
          }
          this.ctx.log("image-gen", "[聊天插入] 得到返回内容，准备更新楼层 #" + _0x2a6a31);
          if (_0xf12a58) {
            chat[_0x2a6a31].mes = _0x377313;
            this.ctx.log("image-gen", "[聊天插入] 智能模式：已全文替换楼层内容。");
          } else {
            const _0x128d2c = _0x3c0feb.settings.chatInsertionStartTag;
            const _0x25d031 = _0x3c0feb.settings.chatInsertionEndTag;
            const _0x3ee4e1 = chat[_0x2a6a31].mes || "";
            if (_0x128d2c && _0x25d031 && _0x3ee4e1.includes(_0x128d2c) && _0x3ee4e1.includes(_0x25d031)) {
              const _0x3c4947 = new RegExp(_0x128d2c + "[\\s\\S]*?" + _0x25d031, "g");
              if (_0x3c4947.test(_0x3ee4e1)) {
                const _0x174566 = await this.ctx.helpers.promptConfirm("检测到已存在的标签内容，是否覆盖原内容？");
                if (_0x174566) {
                  chat[_0x2a6a31].mes = _0x3ee4e1.replace(_0x3c4947, _0x128d2c + "\n" + _0x377313 + "\n" + _0x25d031);
                  this.ctx.log("image-gen", "[聊天插入] 找到标签对并覆盖内容。");
                } else {
                  const _0x3445f9 = _0x3ee4e1.endsWith("\n") ? "\n" : "\n\n";
                  chat[_0x2a6a31].mes = _0x3ee4e1 + _0x3445f9 + (_0x128d2c + "\n" + _0x377313 + "\n" + _0x25d031);
                  this.ctx.log("image-gen", "[聊天插入] 用户选择不覆盖，已将内容插入最底部。");
                }
              }
            } else {
              const _0x2c3ead = _0x3ee4e1.endsWith("\n") ? "\n" : "\n\n";
              chat[_0x2a6a31].mes = _0x3ee4e1 + _0x2c3ead + (_0x128d2c + "\n" + _0x377313 + "\n" + _0x25d031);
              this.ctx.log("image-gen", "[聊天插入] 未找到标签对，已自动添加标签并插入最底部。");
            }
          }
          if (chat[_0x2a6a31].extra && chat[_0x2a6a31].extra.display_text) {
            delete chat[_0x2a6a31].extra.display_text;
          }
          updateMessageBlock(_0x2a6a31, chat[_0x2a6a31]);
          if (eventSource && event_types) {
            await eventSource.emit(event_types.MESSAGE_UPDATED, _0x2a6a31);
          }
          await saveChatConditional();
          this.ctx.helpers.showToast("✨ 内容已更新并保存", "success");
        } else {
          console.warn("[TSP] AI processChatInsertionWithAI 返回为空");
        }
      } catch (_0x2aa18f) {
        this.ctx.error("image-gen", "聊天插入流程出错:", _0x2aa18f);
        this.ctx.helpers.showToast("操作失败: " + _0x2aa18f.message, "error");
      } finally {
        if (_0x3d9e17 && _0x3d9e17.isConnected) {
          _0x3d9e17.innerHTML = _0x41d03d;
          _0x3d9e17.style.pointerEvents = "auto";
        }
      }
    });
    const _0x3b3d34 = document.createElement("div");
    _0x3b3d34.className = "tsp-ai-gen-btn";
    _0x3b3d34.title = "AI 读取上下文并生成/提取角色数据";
    _0x3b3d34.innerHTML = "<i class=\"fa-solid fa-user-plus\"></i>";
    _0x3b3d34.style.cursor = "pointer";
    _0x3b3d34.addEventListener("click", async _0x44e02e => {
      _0x44e02e.stopPropagation();
      const _0xe0c62a = this.ctx.getModule("characterDB");
      if (!_0xe0c62a) {
        this.ctx.helpers.showToast("CharacterDB 模块未就绪", "error");
        return;
      }
      const _0x44cbb7 = await this.ctx.helpers.promptInput("请输入要提取的上下文深度(楼层数)：\nAI 将读取这些内容来分析角色外貌。", "3");
      if (_0x44cbb7 === null) {
        return;
      }
      const _0x2741b5 = parseInt(_0x44cbb7);
      if (isNaN(_0x2741b5) || _0x2741b5 < 1) {
        this.ctx.helpers.showToast("请输入有效的数字 (最小为1)", "warning");
        return;
      }
      const _0xdeadcb = _0x3b3d34.innerHTML;
      _0x3b3d34.innerHTML = "<i class=\"fa-solid fa-spinner fa-spin\"></i>";
      _0x3b3d34.style.pointerEvents = "none";
      try {
        const _0x2db4df = parseInt(_0x360a4d.getAttribute("mesid"));
        if (isNaN(_0x2db4df) || !chat || !chat[_0x2db4df]) {
          throw new Error("无法定位当前消息在聊天记录中的位置");
        }
        const _0x2bd0ee = Math.max(0, _0x2db4df - _0x2741b5 + 1);
        const _0x191e45 = chat.slice(_0x2bd0ee, _0x2db4df + 1);
        const _0x33339b = _0x191e45.map(_0x5a3d6a => {
          let _0x466e0a = _0x5a3d6a.mes || "";
          _0x466e0a = _0x466e0a.replace(/\[img\].*?\[\/img\]/gi, "").trim();
          return _0x5a3d6a.name + ": " + _0x466e0a;
        }).join("\n\n");
        if (!_0x33339b) {
          throw new Error("提取到的上下文为空");
        }
        this.ctx.log("image-gen", "[角色提取] 已提取 " + _0x191e45.length + " 条消息，准备发送给 CharacterDB");
        await _0xe0c62a.startContextualCharacterGeneration(_0x33339b);
      } catch (_0x36814b) {
        console.error(_0x36814b);
        this.ctx.helpers.showToast("操作失败: " + _0x36814b.message, "error");
      } finally {
        if (_0x3b3d34.isConnected) {
          _0x3b3d34.innerHTML = _0xdeadcb;
          _0x3b3d34.style.pointerEvents = "auto";
        }
      }
    });
    _0x4629a5.appendChild(_0x3b3d34);
    _0x4629a5.appendChild(_0x405824);
    _0x4629a5.appendChild(_0x3d9e17);
    _0x250a0a.appendChild(_0x4629a5);
  }
  async generate(_0x2eca2f, _0x13acba = false) {
    if (_0x2eca2f?._fromPromptBuilder) {
      return this.generateFromPrompt(_0x2eca2f.dataset?.link || "", _0x2eca2f.dataset?.negative || "");
    }
    if (this.isGenerating && !_0x13acba) {
      return {
        success: false,
        reason: "generating"
      };
    }
    let _0x3355b3 = _0x2eca2f?.dataset?.link || _0x2eca2f?.prompt || "";
    const _0x4c5869 = _0x2eca2f?.dataset?.negative || "";
    const _0x40f3aa = _0x2eca2f?.dataset?.locationHash;
    if (_0x40f3aa) {
      try {
        const _0x184391 = _0x2eca2f?.dataset?.imageId;
        if (_0x184391) {
          const _0x15bc33 = await this.getCachedImage(_0x184391);
          if (_0x15bc33?.editedPrompt) {
            this.ctx.log("image-gen", "使用已编辑的提示词");
            _0x3355b3 = _0x15bc33.editedPrompt;
          }
        }
      } catch (_0x1524bc) {
        this.ctx.warn("image-gen", "检查已编辑提示词失败:", _0x1524bc);
      }
    }
    if (!_0x3355b3) {
      this.ctx.helpers.showToast("未找到提示词", "warning");
      return {
        success: false,
        reason: "no_prompt"
      };
    }
    const _0x411605 = this.ctx.getModule("aiProcessor");
    if (_0x411605 && !_0x13acba) {
      await _0x411605.findAndStoreStoryContext(_0x2eca2f);
    }
    const _0x5f3a48 = {
      buttonEl: _0x2eca2f,
      isModalCall: _0x13acba,
      locationHash: _0x40f3aa
    };
    return this.generateFromPrompt(_0x3355b3, _0x4c5869, _0x5f3a48);
  }
  async generateFromPrompt(_0x39c531, _0x33d9af = "", _0x44f6cb = {}) {
    const _0x67e561 = await this.ctx.api.getValue("text2img_enabled", true);
    if (!_0x67e561) {
      this.ctx.helpers.showToast("文生图功能已关闭", "warning");
      return {
        error: "文生图功能已关闭"
      };
    }
    const _0x2ee3f3 = _0x39c531;
    const {
      buttonEl: _0xb141ee,
      isModalCall: _0x5b4652,
      locationHash: _0x2ddac4,
      i2iEnabled: _0x455ff1,
      i2iImage: _0x334009,
      i2iMask: _0x182618,
      skipAiProcessing: _0x5381cc,
      customParams: _0x517711
    } = _0x44f6cb;
    this.ctx.log("image-gen", "generateFromPrompt customParams:", _0x517711);
    let _0x4c1d72 = _0x39c531;
    let _0x193b8d = _0x33d9af;
    const _0x5799e9 = /Negative prompt[:：]([\s\S]*)/i;
    const _0x2417a5 = _0x4c1d72.match(_0x5799e9);
    if (_0x2417a5) {
      const _0xd83e3b = _0x2417a5[1].trim();
      _0x4c1d72 = _0x4c1d72.replace(_0x2417a5[0], "").trim();
      if (_0x193b8d) {
        _0x193b8d = _0x193b8d + ", " + _0xd83e3b;
      } else {
        _0x193b8d = _0xd83e3b;
      }
      this.ctx.log("image-gen", "提取到全局负面提示词，已附加: \"" + _0xd83e3b + "\"");
    }
    const _0x98014d = await this.ctx.api.getValue("concurrent_requests_enabled", false);
    if (this.isGenerating && !_0x98014d) {
      const _0x1ea388 = {
        positive: _0x4c1d72,
        negative: _0x193b8d,
        options: _0x44f6cb
      };
      this.generationQueue.push(_0x1ea388);
      return {
        queued: true
      };
    }
    if (!_0x98014d) {
      this.isGenerating = true;
    }
    const _0x1a7e50 = this.settings.currentMode;
    const _0x588d90 = this.settings[_0x1a7e50] || {};
    const _0x411ea7 = _0x44f6cb.buttonEl?.dataset?.width || _0x588d90.width || this.settings.sd.width;
    const _0x227787 = _0x44f6cb.buttonEl?.dataset?.height || _0x588d90.height || this.settings.sd.height;
    this.ctx.helpers.userLog("REQUEST", "开始生成图片 (请求参数)", {
      生成模式: _0x1a7e50.toUpperCase(),
      分辨率: _0x411ea7 + " x " + _0x227787,
      "提示词 (Preview)": _0x4c1d72.substring(0, 60) + (_0x4c1d72.length > 60 ? "..." : ""),
      "负面提示词 (Preview)": _0x193b8d.substring(0, 60) + (_0x193b8d.length > 60 ? "..." : ""),
      步数: _0x588d90.steps,
      "引导系数 (Scale/CFG)": _0x588d90.scale || _0x588d90.cfgScale,
      种子: _0x588d90.seed === -1 ? "随机 (-1)" : _0x588d90.seed
    });
    const _0x352dfe = {
      positive: _0x4c1d72,
      negative: _0x193b8d
    };
    this.ctx.events.emit(EventTypes.IMAGE_GEN_START, _0x352dfe);
    if (_0x455ff1) {
      const _0xc92e03 = _0x182618 ? "蒙版重绘" : "图生图";
    }
    if (_0xb141ee) {
      this._updateButtonStatus(_0xb141ee, "loading", _0x455ff1 ? _0x182618 ? "蒙版重绘" : "图生图" : "");
    }
    try {
      this.ctx.log("image-gen", "开始生成 (i2i=" + _0x455ff1 + ", mask=" + !!_0x182618 + ")");
      let _0x31b069 = _0x4c1d72;
      const _0x4ead11 = this.ctx.getModule("aiProcessor");
      const _0x20f137 = _0x5381cc === true || _0xb141ee?._skipAiProcessing === true;
      if (_0x20f137) {
        this.ctx.log("image-gen", "接收到 skipAiProcessing 标志, 跳过AI二次处理。");
      }
      if (_0x4ead11 && !_0x20f137) {
        this.ctx.log("image-gen", "未接收到 skipAiProcessing 标志, 正在执行AI二次处理...");
        _0x31b069 = await _0x4ead11.processPromptWithAI(_0x4c1d72);
      }
      if (_0x455ff1 && _0x2ddac4 && _0x334009) {
        await this.saveI2IData(_0x2ddac4, _0x334009, _0x182618);
      }
      let _0x56e78e;
      const _0x265802 = _0x44f6cb.useComfyWorkflow === true;
      if (_0x265802 && _0x455ff1) {
        this.ctx.log("image-gen", "使用 ComfyUI 工作流进行图生图/蒙版处理");
        _0x56e78e = await this.generateWithComfyUI(_0x31b069, _0x193b8d, _0x44f6cb);
      } else {
        switch (this.settings.currentMode) {
          case "sd":
            _0x56e78e = await this.generateWithSD(_0x31b069, _0x193b8d, _0x44f6cb);
            break;
          case "nai":
            _0x56e78e = await this.generateWithNAI(_0x31b069, _0x193b8d, _0x44f6cb);
            break;
          case "comfyui":
            _0x56e78e = await this.generateWithComfyUI(_0x31b069, _0x193b8d, _0x44f6cb);
            break;
          case "other":
            _0x56e78e = await this.generateWithOther(_0x31b069, _0x193b8d, _0x44f6cb);
            break;
          default:
            throw new Error("未知的生成模式: " + this.settings.currentMode);
        }
      }
      const _0x5e51f4 = {
        result: _0x56e78e
      };
      this.ctx.events.emit(EventTypes.IMAGE_GEN_COMPLETE, _0x5e51f4);
      if (_0x56e78e.success && _0x56e78e.imageUrl) {
        const _0x1d40d9 = {
          imageId: _0x56e78e.imageId
        };
        this.ctx.helpers.userLog("SUCCESS", "图片生成成功", _0x1d40d9);
        const _0xb1af5c = await this._getNextImageId();
        await this.cacheImage(_0xb1af5c, _0x56e78e.imageUrl, _0x2ddac4, _0x2ee3f3, _0x44f6cb.customMode);
        _0x56e78e.imageId = _0xb1af5c;
        if (this.settings.insertIntoChat && !_0x44f6cb.skipInsertToChat) {
          this.insertImageToChat(_0x56e78e.imageUrl);
        }
        if (_0x2ddac4) {
          const _0x34d06b = _0x2ddac4.startsWith("beauty-");
          const _0x489bfc = _0x2ddac4.startsWith("livestreaming-");
          if (!_0x34d06b && !_0x489bfc) {
            const _0x29a653 = document.querySelector(".tsp-inline-gen-btn[data-location-hash=\"" + _0x2ddac4 + "\"]");
            if (_0x29a653 && _0x29a653.isConnected) {
              this._displayImageAtButton(_0x29a653, _0x56e78e.imageUrl, _0xb1af5c, _0x2ddac4);
            } else if (_0xb141ee && _0xb141ee.isConnected) {
              this._displayImageAtButton(_0xb141ee, _0x56e78e.imageUrl, _0xb1af5c, _0x2ddac4);
            } else {
              const _0x526c33 = document.querySelector(".tsp-image-slot[data-location-hash=\"" + _0x2ddac4 + "\"]");
              if (_0x526c33) {
                const _0x120122 = _0x526c33.querySelector("img");
                if (_0x120122) {
                  _0x120122.src = _0x56e78e.imageUrl;
                  _0x120122.dataset.imageId = String(_0xb1af5c);
                }
              }
            }
          }
          this._refreshMessageButtons(_0x2ddac4, _0xb1af5c);
        }
      }
      if (_0xb141ee) {
        this._updateButtonStatus(_0xb141ee, "default");
      }
      return _0x56e78e;
    } catch (_0x1dfdeb) {
      this.ctx.error("image-gen", "生成失败:", _0x1dfdeb);
      this.ctx.helpers.userError("生成流程异常中止", {
        message: _0x1dfdeb.message,
        stack: _0x1dfdeb.stack,
        mode: this.settings.currentMode,
        trigger: _0xb141ee ? "按钮点击" : "自动/其它"
      });
      const _0x51421e = {
        error: _0x1dfdeb
      };
      this.ctx.events.emit(EventTypes.IMAGE_GEN_ERROR, _0x51421e);
      this.ctx.helpers.showToast("生成失败: " + _0x1dfdeb.message, "error");
      if (_0xb141ee) {
        this._updateButtonStatus(_0xb141ee, "default");
      }
      if (_0x5b4652) {
        throw _0x1dfdeb;
      }
      const _0x5423a9 = {
        success: false,
        error: _0x1dfdeb.message
      };
      return _0x5423a9;
    } finally {
      if (!_0x98014d) {
        this.isGenerating = false;
      }
      this.isGenerationInProgress = true;
      if (_0x2ddac4 && this._processingHashes) {
        this._processingHashes.delete(_0x2ddac4);
      }
      if (!_0x98014d && this.generationQueue.length > 0) {
        const _0x218df6 = this.generationQueue.shift();
        setTimeout(() => {
          if (_0x218df6.options.locationHash) {
            const _0x576918 = document.querySelector(".tsp-inline-gen-btn[data-location-hash=\"" + _0x218df6.options.locationHash + "\"]");
            if (_0x576918) {
              _0x576918.innerHTML = "<i class=\"fa-solid fa-spinner fa-spin\"></i> ⏳ 处理中...";
            }
          }
          this.generateFromPrompt(_0x218df6.positive, _0x218df6.negative, _0x218df6.options);
        }, 500);
      }
    }
  }
  async generateFromContext(_0x24e1dc) {
    const _0x236aa3 = this.ctx.getModule("aiProcessor");
    if (_0x236aa3) {
      _0x236aa3.setStoryContext(_0x24e1dc);
      const _0x4cbd74 = this.ctx.promptBuilder;
      if (_0x4cbd74) {
        await _0x4cbd74.submitToGenerator();
        return;
      }
    }
    this.ctx.helpers.showToast("请先配置提示词或 AI 处理器", "warning");
  }
  _getDefaultNegative() {
    const _0x1575f4 = this.ctx.promptBuilder;
    if (_0x1575f4) {
      return _0x1575f4.buildNegativePrompt();
    }
    return "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry";
  }
  async generateWithSD(_0x55ff58, _0x2537bd, _0x3fc17c = {}) {
    const _0x104746 = this.settings.sd;
    const {
      i2iEnabled: _0x3afcef,
      i2iImage: _0x17af2c,
      i2iMask: _0x11bf7a,
      customParams: _0x141325,
      skipPresets: _0x2af599
    } = _0x3fc17c;
    const _0x3495b0 = _0x104746.apiMode || "original";
    if (!_0x104746.url) {
      throw new Error("请先配置 Stable Diffusion URL");
    }
    const _0x8eb5b6 = this._removeTrailingSlash(_0x104746.url);
    const _0x3ed806 = _0x3afcef && _0x17af2c;
    const _0x1d5382 = _0x3ed806 && _0x11bf7a;
    this.ctx.log("image-gen", "SD 生成: " + _0x8eb5b6 + " [模式:" + _0x3495b0 + ", i2i:" + _0x3ed806 + ", skipPresets:" + _0x2af599 + "]");
    const _0x1e6469 = this.ctx.getModule("triggerProcessor");
    if (_0x1e6469) {
      _0x55ff58 = await _0x1e6469.processTriggers(_0x55ff58);
      if (_0x2537bd) {
        _0x2537bd = await _0x1e6469.processTriggers(_0x2537bd);
      }
    }
    const _0x1cd196 = await this._buildPositivePrompt(_0x55ff58, _0x2af599);
    const _0x1ca549 = await this._buildNegativePrompt(_0x2537bd, _0x2af599);
    const _0x4431df = {
      prompt: _0x1cd196,
      negative_prompt: _0x1ca549,
      sampler_name: _0x141325?.sampler || _0x104746.sampler,
      scheduler: _0x141325?.scheduler || _0x104746.scheduler,
      steps: Number(_0x141325?.steps || _0x104746.steps),
      cfg_scale: Number(_0x141325?.cfgScale || _0x104746.cfgScale),
      width: Number(_0x3fc17c.buttonEl?.dataset?.width || _0x141325?.width || _0x104746.width),
      height: Number(_0x3fc17c.buttonEl?.dataset?.height || _0x141325?.height || _0x104746.height),
      seed: (() => {
        if (_0x141325?.seed !== undefined && _0x141325?.seed !== -1) {
          return Number(_0x141325.seed);
        }
        const _0x5d3da7 = _0x104746.seed;
        if (_0x5d3da7 === undefined || _0x5d3da7 === null || _0x5d3da7 === "" || Number(_0x5d3da7) === -1) {
          return -1;
        }
        return Number(_0x5d3da7);
      })(),
      restore_faces: !!_0x104746.restoreFaces,
      batch_size: 1,
      n_iter: 1,
      save_images: true,
      send_images: true,
      do_not_save_grid: false,
      do_not_save_samples: false
    };
    if (_0x3ed806) {
      _0x4431df.init_images = [this._extractBase64(_0x17af2c)];
      _0x4431df.denoising_strength = Number(this.i2iSettings.strength || 0.7);
      if (_0x1d5382) {
        _0x4431df.mask = this._extractBase64(_0x11bf7a);
        _0x4431df.mask_blur = Number(_0x104746.adMaskBlur || 4);
        _0x4431df.inpainting_fill = 1;
        _0x4431df.inpaint_full_res = true;
        _0x4431df.inpaint_full_res_padding = Number(_0x104746.adInpaintPadding || 32);
      }
    }
    if (_0x104746.enableHr && !_0x3ed806) {
      Object.assign(_0x4431df, {
        enable_hr: true,
        hr_scale: Number(_0x104746.hrScale),
        denoising_strength: Number(_0x104746.hrDenoisingStrength),
        hr_upscaler: _0x104746.hrUpscaler,
        hr_second_pass_steps: Number(_0x104746.hrSecondPassSteps)
      });
    }
    _0x4431df.override_settings = {};
    _0x4431df.override_settings_restore_afterwards = true;
    _0x4431df.alwayson_scripts = {};
    if (_0x104746.adetailerEnabled) {
      _0x4431df.alwayson_scripts.ADetailer = {
        args: [true, false, {
          ad_model: _0x104746.adModel || "face_yolov8n.pt",
          ad_denoising_strength: Number(_0x104746.adDenoisingStrength || 0.4),
          ad_mask_blur: Number(_0x104746.adMaskBlur || 4),
          ad_inpaint_only_masked_padding: Number(_0x104746.adInpaintPadding || 32)
        }]
      };
    }
    if (_0x104746.controlNetEnabled && _0x104746.controlNetUnits?.length > 0) {
      const _0x77a81b = _0x104746.controlNetUnits.filter(_0x57f069 => _0x57f069.enabled);
      if (_0x77a81b.length > 0) {
        _0x4431df.alwayson_scripts.ControlNet = {
          args: _0x77a81b.map(_0x39be57 => ({
            enabled: true,
            image: this._extractBase64(_0x39be57.image),
            module: _0x39be57.module,
            model: _0x39be57.model,
            weight: _0x39be57.weight || 1,
            resize_mode: _0x39be57.resize_mode,
            low_vram: _0x39be57.lowvram || false,
            processor_res: Number(_0x39be57.processor_res || 512),
            guidance_start: Number(_0x39be57.guidance_start || 0),
            guidance_end: Number(_0x39be57.guidance_end || 1),
            control_mode: _0x39be57.control_mode,
            pixel_perfect: _0x39be57.pixel_perfect || false,
            threshold_a: Number(_0x39be57.threshold_a !== undefined ? _0x39be57.threshold_a : 64),
            hr_option: "Both",
            input_mode: "simple",
            batch_images: ""
          }))
        };
      }
    }
    if (Object.keys(_0x4431df.alwayson_scripts).length === 0) {
      delete _0x4431df.alwayson_scripts;
    }
    if (!this.isGenerationInProgress) {
      await this._sleep(500);
    }
    this.isGenerationInProgress = false;
    if (_0x3495b0 === "original") {
      const _0x4b339d = {
        ..._0x4431df
      };
      _0x4b339d.url = _0x8eb5b6;
      _0x4b339d.auth = _0x104746.auth;
      const _0x102caf = _0x4b339d;
      try {
        this.ctx.log("image-gen", "Sending via ST Proxy:", _0x102caf);
        const _0x557e30 = await fetch("/api/sd/generate", {
          method: "POST",
          headers: getRequestHeaders(),
          body: JSON.stringify(_0x102caf)
        });
        if (!_0x557e30.ok) {
          const _0x126eb3 = await _0x557e30.text();
          throw new Error("ST Proxy Error (" + _0x557e30.status + "): " + _0x126eb3);
        }
        const _0x49741a = await _0x557e30.json();
        if (_0x49741a.images && _0x49741a.images.length > 0) {
          const _0x542904 = _0x49741a.images[0];
          const _0x67992d = "data:image/png;base64," + _0x542904;
          const _0x418fdd = {
            success: true,
            imageUrl: _0x67992d,
            imageBase64: _0x542904,
            info: _0x49741a.info,
            finalPositive: _0x1cd196,
            finalNegative: _0x1ca549
          };
          return _0x418fdd;
        } else {
          throw new Error("ST Proxy 未返回图片数据 (Result is empty)");
        }
      } catch (_0x4b6adc) {
        throw new Error("SD 生成失败 (Proxy): " + _0x4b6adc.message);
      }
    } else {
      const _0xfb9181 = _0x3ed806 ? _0x8eb5b6 + "/sdapi/v1/img2img" : _0x8eb5b6 + "/sdapi/v1/txt2img";
      try {
        this.ctx.log("image-gen", "Sending Direct to SD:", _0xfb9181, _0x4431df);
        let _0x3d70e1;
        try {
          _0x3d70e1 = await fetch(_0xfb9181, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(_0x104746.auth ? {
                Authorization: "Basic " + btoa(_0x104746.auth)
              } : {})
            },
            body: JSON.stringify(_0x4431df)
          });
        } catch (_0x2d37a5) {
          this.ctx.helpers.userError("SD 连接失败", {
            url: _0xfb9181,
            error: _0x2d37a5.message,
            hint: "请检查 SD 是否启动，以及 --api 和 --cors-allow-origins 参数是否配置"
          });
          throw _0x2d37a5;
        }
        if (!_0x3d70e1.ok) {
          const _0x33cb2b = await _0x3d70e1.text();
          throw new Error("Direct HTTP " + _0x3d70e1.status + ": " + _0x33cb2b);
        }
        const _0x3277db = await _0x3d70e1.json();
        if (_0x3277db.images && _0x3277db.images.length > 0) {
          const _0x22af90 = _0x3277db.images[0];
          const _0x5ca181 = "data:image/png;base64," + _0x22af90;
          const _0x2d9de8 = {
            success: true,
            imageUrl: _0x5ca181,
            imageBase64: _0x22af90,
            info: _0x3277db.info,
            finalPositive: _0x1cd196,
            finalNegative: _0x1ca549
          };
          return _0x2d9de8;
        } else {
          throw new Error("SD WebUI 未返回图片数据");
        }
      } catch (_0x11178b) {
        const _0x52de27 = {
          error: _0x11178b.message,
          url: _0x8eb5b6,
          payload: _0x4431df
        };
        this.ctx.helpers.userError("SD 生成请求失败", _0x52de27);
        throw new Error("SD 生成失败 (Direct): " + _0x11178b.message);
      }
    }
  }
  async generateWithNAI(_0x465239, _0x1ba71d, _0x2d89e3 = {}) {
    let _0x2ce20d = this.settings.nai;
    const {
      skipPresets: _0x33c644
    } = _0x2d89e3;
    const _0xa5ae69 = this.ctx.getModule("triggerProcessor");
    if (_0xa5ae69) {
      _0x465239 = await _0xa5ae69.processTriggers(_0x465239);
      _0x1ba71d &&= await _0xa5ae69.processTriggers(_0x1ba71d);
    }
    _0x2ce20d = await this._applyNaiTriggerOverrides(_0x465239, _0x2ce20d);
    const {
      i2iEnabled: _0x4a5bae,
      i2iImage: _0x43815d,
      i2iMask: _0x4637c9,
      naiI2iStrength: _0x4f5881,
      naiI2iNoise: _0x10091b,
      naiInpaintStrength: _0x5f2b4b,
      customParams: _0x3137dd
    } = _0x2d89e3;
    if (_0x4f5881 !== undefined) {
      _0x2ce20d.i2iStrength = _0x4f5881;
    }
    if (_0x10091b !== undefined) {
      _0x2ce20d.i2iNoise = _0x10091b;
    }
    if (_0x5f2b4b !== undefined) {
      _0x2ce20d.inpaintStrength = _0x5f2b4b;
    }
    const _0x4cdc84 = _0x4a5bae && _0x43815d;
    const _0x21dd16 = _0x4cdc84 && _0x4637c9;
    this.ctx.log("image-gen", "NAI 生成 (img2img=" + _0x4cdc84 + ", inpaint=" + _0x21dd16 + ")");
    const _0x4c2fe5 = {
      当前操作: _0x4cdc84 ? _0x21dd16 ? "局部重绘 (Inpaint)" : "图生图 (Img2Img)" : "文生图 (Txt2Img)",
      模型架构: _0x2ce20d.model,
      预设尺寸: _0x2ce20d.sizePreset || _0x2ce20d.width + "x" + _0x2ce20d.height,
      分辨率: (_0x2d89e3.buttonEl?.dataset?.width || _0x2ce20d.width) + " x " + (_0x2d89e3.buttonEl?.dataset?.height || _0x2ce20d.height),
      "多角色模式 (Multi-Char)": !!_0x2ce20d.multiRoleEnabled,
      "参考模式 (Vibe/Ref)": !!_0x2ce20d.vibeEnabled
    };
    const _0x226c7a = _0x4c2fe5;
    if (_0x2ce20d.vibeEnabled) {
      _0x226c7a.参考模式详情 = {
        模式类型: _0x2ce20d.referenceMode === "director" ? "人物参考 (Director)" : "风格参考 (Vibe)",
        参考图数量: _0x2ce20d.vibeImages ? _0x2ce20d.vibeImages.length : 0,
        参考图列表: (_0x2ce20d.vibeImages || []).map((_0x4519a5, _0x34320d) => ({
          index: _0x34320d + 1,
          type: _0x4519a5.type || "image",
          strength: _0x4519a5.strength || 0.6,
          keepState: true
        }))
      };
    }
    if (_0x2ce20d.multiRoleEnabled) {
      _0x226c7a.多角色详情 = {
        角色列表: (_0x2ce20d.multiRoleList || []).map(_0x11ad48 => ({
          position: _0x11ad48.position,
          hasPrompt: !!_0x11ad48.prompt,
          hasUC: !!_0x11ad48.negativePrompt
        }))
      };
    }
    this.ctx.helpers.userLog("INFO", "NAI 功能状态检查", _0x226c7a);
    let _0x373a57 = await this._buildPositivePrompt(_0x465239, _0x33c644);
    let _0x3f205a = await this._buildNegativePrompt(_0x1ba71d, _0x33c644);
    let _0xed06ba;
    if (_0x2ce20d.multiRoleEnabled === false && MultiCharacterParser.isMultiCharacterPrompt(_0x465239)) {
      this.ctx.log("image-gen", "NAI多角色未开启但检测到语法，执行智能平铺并提取负面...");
      const _0x3d9a66 = MultiCharacterParser.flattenAndExtractUC(_0x465239);
      _0x373a57 = await this._buildPositivePrompt(_0x3d9a66.positive, _0x33c644);
      if (_0x3d9a66.negative) {
        let _0x3f8d0b = [_0x3f205a, _0x3d9a66.negative].filter(Boolean).join(", ");
        _0x3f205a = _0x3f8d0b;
      }
      this.ctx.log("image-gen", "平铺后正面: " + _0x373a57.substring(0, 100) + "...");
      this.ctx.log("image-gen", "合并后负面: " + _0x3f205a.substring(0, 100) + "...");
    }
    const _0x473361 = Math.floor(Math.random() * 10000000000);
    let _0x3ab8dd;
    if (_0x3137dd?.seed !== undefined && _0x3137dd?.seed !== -1) {
      _0x3ab8dd = Number(_0x3137dd.seed);
    } else {
      _0x3ab8dd = _0x2ce20d.seed === -1 ? _0x473361 + 1 : Number(_0x2ce20d.seed);
    }
    const _0x69e167 = Number(_0x2d89e3.buttonEl?.dataset?.width) || Number(_0x3137dd?.width) || Number(_0x2ce20d.width) || 832;
    const _0x124289 = Number(_0x2d89e3.buttonEl?.dataset?.height) || Number(_0x3137dd?.height) || Number(_0x2ce20d.height) || 1216;
    if (!this.isGenerationInProgress) {
      await this._sleep(1000);
    }
    this.isGenerationInProgress = false;
    try {
      let _0x4dc14c;
      const _0x231837 = _0x3137dd?.model || _0x2ce20d.model || "nai-diffusion-3";
      this.ctx.log("image-gen", "NAI 请求: 渠道=" + _0x2ce20d.channel + ", 模型=" + _0x231837);
      if (_0x2ce20d.channel === "official") {
        let _0x3e906c = _0x2ce20d.proxyUrl ? this._removeTrailingSlash(_0x2ce20d.proxyUrl) : ImageGenerator.DEFAULT_NAI_OFFICIAL_URL;
        const _0x309f9d = _0x3e906c.includes("/ai/generate-image");
        const _0x242765 = _0x309f9d ? _0x3e906c : _0x3e906c + "/ai/generate-image";
        const _0x5ae564 = _0x309f9d ? _0x3e906c.replace("/ai/generate-image", "") : _0x3e906c;
        let _0x26cbe8 = _0x242765;
        if (_0x26cbe8) {
          this.ctx.log("image-gen", "使用自定义反代: " + _0x26cbe8);
          if (!_0x2ce20d.apiKey) {
            throw new Error("使用自定义反代需要配置 NovelAI API Key");
          }
          const _0x1b6fa7 = _0x231837.startsWith("nai-diffusion-4");
          const _0x57037e = {
            params_version: 3,
            width: _0x69e167,
            height: _0x124289,
            scale: Number(_0x3137dd?.scale || _0x2ce20d.scale) || 5,
            sampler: _0x3137dd?.sampler || _0x2ce20d.sampler || "k_euler_ancestral",
            steps: Number(_0x3137dd?.steps || _0x2ce20d.steps) || 28,
            n_samples: 1,
            controlnet_strength: 1,
            legacy: false,
            add_original_image: true,
            cfg_rescale: Number(_0x2ce20d.cfgRescale) || 0,
            noise_schedule: _0x3137dd?.noiseSchedule || _0x2ce20d.noiseSchedule || "karras",
            seed: _0x3ab8dd,
            negative_prompt: _0x3f205a,
            extra_noise_seed: _0x473361
          };
          if (_0x1b6fa7) {
            Object.assign(_0x57037e, {
              ucPreset: 2,
              qualityToggle: true,
              dynamic_thresholding: _0x2ce20d.decrisper === true,
              use_coords: _0x2ce20d.useCoords === true
            });
            if (_0x2ce20d.variety === true) {
              if (_0x231837.includes("nai-diffusion-4-5")) {
                _0x57037e.skip_cfg_above_sigma = 58;
              } else if (_0x231837.includes("nai-diffusion-4")) {
                _0x57037e.skip_cfg_above_sigma = 19;
              }
            }
            const _0x270148 = _0x2ce20d.vibeEnabled === true && _0x2ce20d.vibeImages?.length > 0;
            if (_0x270148) {
              const _0x4c80f6 = _0x2ce20d.referenceMode || "vibe";
              if (_0x4c80f6 === "director") {
                this.ctx.log("image-gen", "启用 Director（人物参考）模式");
                const _0x137b73 = ["nai-diffusion-4-5-full", "nai-diffusion-4-5-curated"];
                if (!_0x137b73.includes(_0x231837)) {
                  throw new Error("Character Reference 仅支持: " + _0x137b73.join(", "));
                }
                const _0x974571 = [];
                const _0x4fd9e9 = [];
                const _0x34a8c1 = [];
                const _0x3457de = [];
                const _0x269b51 = [];
                for (const _0x542d3d of _0x2ce20d.vibeImages) {
                  const _0x5527ac = _0x542d3d.image || _0x542d3d.base64 || "";
                  const _0x617d48 = await this._resolveImageToDataURL(_0x5527ac);
                  if (!_0x617d48) {
                    throw new Error("无法加载 Character Reference 的参考图");
                  }
                  const _0x6e9590 = await this._processDirectorImage(_0x617d48);
                  const _0x208fad = this._extractBase64(_0x6e9590);
                  const _0x274bce = _0x542d3d.mode || "character";
                  const _0x32a97c = 1;
                  const _0x3f8645 = _0x542d3d.strength ?? 1;
                  const _0x467c28 = 1 - _0x3f8645;
                  const _0x536f70 = {
                    base_caption: _0x274bce,
                    char_captions: []
                  };
                  const _0x1620c1 = {
                    caption: _0x536f70,
                    legacy_uc: false
                  };
                  _0x974571.push(_0x1620c1);
                  _0x4fd9e9.push(_0x32a97c);
                  _0x34a8c1.push(_0x3f8645);
                  _0x3457de.push(_0x467c28);
                  _0x269b51.push(_0x208fad);
                }
                const _0x1ab1b2 = {
                  legacy_v3_extend: false,
                  normalize_reference_strength_multiple: false,
                  characterPrompts: [],
                  director_reference_images: _0x269b51,
                  director_reference_descriptions: _0x974571,
                  director_reference_information_extracted: _0x4fd9e9,
                  director_reference_strength_values: _0x34a8c1,
                  director_reference_secondary_strength_values: _0x3457de
                };
                Object.assign(_0x57037e, _0x1ab1b2);
              } else {
                this.ctx.log("image-gen", "启用 Vibe（氛围）模式");
                const _0x591439 = {
                  "nai-diffusion-4-full": "v4full",
                  "nai-diffusion-4-curated-preview": "v4curated",
                  "nai-diffusion-4-5-full": "v4-5full",
                  "nai-diffusion-4-5-curated": "v4-5curated"
                };
                const _0x54eb09 = _0x591439[_0x231837];
                if (!_0x54eb09) {
                  throw new Error("当前模型 " + _0x231837 + " 不支持 V4 Vibe");
                }
                const _0x3145bf = [];
                const _0x4affae = [];
                const _0x1eb578 = [];
                for (const _0x5e0b42 of _0x2ce20d.vibeImages) {
                  if (_0x5e0b42.type === "vibeFile" && _0x5e0b42.vibeData?.encodings) {
                    let _0x3f9e80 = null;
                    if (typeof _0x5e0b42.vibeData.encodings === "string") {
                      if (_0x5e0b42.vibeData.encodings.startsWith("data:application/binary;base64,")) {
                        _0x3f9e80 = _0x5e0b42.vibeData.encodings.substring("data:application/binary;base64,".length);
                      } else {
                        _0x1eb578.push("文件 " + (_0x5e0b42.vibeData.name || "unknown") + " 的 encodings 格式不正确");
                      }
                    } else if (_0x5e0b42.vibeData.encodings?.[_0x54eb09]) {
                      const _0x3c348a = Object.values(_0x5e0b42.vibeData.encodings[_0x54eb09])[0];
                      if (_0x3c348a?.encoding) {
                        _0x3f9e80 = _0x3c348a.encoding;
                      } else {
                        _0x1eb578.push("文件 " + (_0x5e0b42.vibeData.name || "unknown") + " 缺少 encoding");
                      }
                    } else {
                      _0x1eb578.push("文件 " + (_0x5e0b42.vibeData.name || "unknown") + " 不包含当前模型 " + _0x54eb09 + " 的 encoding");
                    }
                    if (_0x3f9e80) {
                      _0x3145bf.push(_0x3f9e80);
                      _0x4affae.push(_0x5e0b42.strength || 0.6);
                    }
                  } else if (_0x5e0b42.type === "image" || _0x5e0b42.image) {
                    _0x1eb578.push("V4+ Vibe 仅支持 .naiv4vibe 文件，请使用 NAI 官网生成 vibe 文件");
                  } else {
                    _0x1eb578.push("无效的参考图数据");
                  }
                }
                if (_0x1eb578.length > 0) {
                  this.ctx.log("image-gen", "Vibe 配置警告:", _0x1eb578.join("; "));
                  if (_0x3145bf.length === 0) {
                    throw new Error("Vibe 配置错误: " + _0x1eb578.join("; "));
                  }
                }
                if (_0x3145bf.length > 0) {
                  _0x57037e.reference_image_multiple = _0x3145bf;
                  _0x57037e.reference_strength_multiple = _0x4affae;
                }
              }
            }
            const _0x590ee9 = _0x2ce20d.multiRoleEnabled === true && MultiCharacterParser.isMultiCharacterPrompt(_0x465239);
            if (_0x590ee9) {
              this.ctx.log("image-gen", "检测到多角色语法，启用角色定位模式");
              const _0x14e80b = MultiCharacterParser.parseScene(_0x465239);
              const _0x17bc03 = _0x14e80b["Scene Composition"] || "";
              const _0x46c2ba = await this._buildPositivePrompt(_0x17bc03.trim(), _0x33c644);
              _0x373a57 = _0x46c2ba;
              const _0x564e3f = [];
              const _0xfa7259 = [];
              const _0x476caa = this.ctx.getModule("triggerProcessor");
              for (let _0x5bb6bd = 1; _0x5bb6bd <= 4; _0x5bb6bd++) {
                let _0x59855e = _0x14e80b["Character " + _0x5bb6bd + " Prompt"];
                if (_0x59855e) {
                  const _0x306a68 = _0x14e80b["Character " + _0x5bb6bd + " coordinates"];
                  let _0x45ac0f = _0x14e80b["Character " + _0x5bb6bd + " UC"] || "";
                  if (_0x476caa) {
                    _0x59855e = this._cleanPromptText(_0x59855e);
                    _0x59855e = await _0x476caa.processTriggers(_0x59855e, true);
                    if (_0x45ac0f) {
                      _0x45ac0f = this._cleanPromptText(_0x45ac0f);
                      _0x45ac0f = await _0x476caa.processTriggers(_0x45ac0f, true);
                    }
                  }
                  const _0x1a5fb6 = {
                    char_caption: _0x59855e,
                    centers: [_0x306a68]
                  };
                  _0x564e3f.push(_0x1a5fb6);
                  const _0x12fa36 = {
                    char_caption: _0x45ac0f,
                    centers: [_0x306a68]
                  };
                  _0xfa7259.push(_0x12fa36);
                }
              }
              const _0x4335fb = {
                base_caption: _0x46c2ba,
                char_captions: _0x564e3f
              };
              _0x57037e.v4_prompt = {
                caption: _0x4335fb,
                use_coords: _0x57037e.use_coords || false,
                use_order: true
              };
              const _0x13bbf6 = {
                base_caption: _0x3f205a,
                char_captions: _0xfa7259
              };
              const _0x3a6111 = {
                caption: _0x13bbf6
              };
              _0x57037e.v4_negative_prompt = _0x3a6111;
            } else {
              let _0x19b54b = _0x465239;
              if (MultiCharacterParser.isMultiCharacterPrompt(_0x465239)) {
                this.ctx.log("image-gen", "检测到多角色语法但未启用多角色模式，将平铺为普通 Tags");
                _0x19b54b = MultiCharacterParser.flattenMultiCharacterPrompt(_0x465239);
              }
              const _0x20500c = await this._buildPositivePrompt(_0x19b54b, _0x33c644);
              _0x373a57 = _0x20500c;
              const _0x6c22c0 = {
                base_caption: _0x20500c,
                char_captions: []
              };
              _0x57037e.v4_prompt = {
                caption: _0x6c22c0,
                use_coords: _0x57037e.use_coords || false,
                use_order: true
              };
              const _0x243f90 = {
                base_caption: _0x3f205a,
                char_captions: []
              };
              const _0x47b151 = {
                caption: _0x243f90
              };
              _0x57037e.v4_negative_prompt = _0x47b151;
            }
          } else {
            Object.assign(_0x57037e, {
              ucPreset: 3,
              qualityToggle: true,
              sm: _0x2ce20d.sm === true,
              sm_dyn: _0x2ce20d.dyn === true && _0x2ce20d.sm === true,
              dynamic_thresholding: _0x2ce20d.decrisper === true
            });
            if (_0x2ce20d.variety === true) {
              _0x57037e.skip_cfg_above_sigma = 19;
            }
            const _0x3e17fe = _0x2ce20d.vibeEnabled === true && _0x2ce20d.vibeImages?.length > 0;
            if (_0x3e17fe) {
              this.ctx.log("image-gen", "启用 V3 Vibe Transfer 模式");
              const _0x1912bd = [];
              const _0x248f75 = [];
              const _0x1f9093 = [];
              for (const _0x4d2eea of _0x2ce20d.vibeImages) {
                if (_0x4d2eea.type === "image" || _0x4d2eea.image) {
                  const _0x106ea7 = this._extractBase64(_0x4d2eea.image || _0x4d2eea.base64 || "");
                  if (_0x106ea7) {
                    _0x1912bd.push(_0x106ea7);
                    _0x248f75.push(_0x4d2eea.infoExtracted || 1);
                    _0x1f9093.push(_0x4d2eea.strength || 0.6);
                  }
                }
              }
              if (_0x1912bd.length > 0) {
                _0x57037e.reference_image_multiple = _0x1912bd;
                _0x57037e.reference_information_extracted_multiple = _0x248f75;
                _0x57037e.reference_strength_multiple = _0x1f9093;
              } else if (_0x2ce20d.vibeImages.length > 0) {
                this.ctx.log("image-gen", "警告: V3 模型忽略了 .naiv4vibe 文件，请使用普通图片");
              }
            }
          }
          let _0xdb1ebf = "generate";
          let _0x17d922 = _0x231837;
          if (_0x4cdc84) {
            const _0x4571dd = this._extractBase64(_0x43815d);
            _0x57037e.image = _0x4571dd;
            _0x57037e.extra_noise_seed = _0x473361;
            if (_0x21dd16) {
              _0xdb1ebf = "infill";
              const _0x197679 = this._extractBase64(_0x4637c9);
              _0x57037e.mask = _0x197679;
              _0x57037e.add_original_image = false;
              _0x57037e.strength = 1;
              _0x57037e.noise = 0;
              _0x57037e.prefer_brownian = true;
              _0x57037e.autoSmea = false;
              _0x57037e.deliberate_euler_ancestral_bug = false;
              _0x57037e.legacy_uc = false;
              _0x57037e.normalize_reference_strength_multiple = false;
              const _0x14694a = Number(_0x2ce20d.inpaintStrength ?? 1);
              _0x57037e.inpaintImg2ImgStrength = _0x14694a;
              const _0x362bc8 = {
                strength: _0x14694a,
                color_correct: true
              };
              _0x57037e.img2img = _0x362bc8;
              if (!_0x17d922.includes("inpainting")) {
                this.ctx.log("image-gen", "[Infill] 将模型 " + _0x17d922 + " 自动切换为 " + _0x17d922 + "-inpainting");
                _0x17d922 = _0x17d922 + "-inpainting";
              }
            } else {
              _0xdb1ebf = "img2img";
              _0x57037e.add_original_image = true;
              _0x57037e.strength = Number(_0x2ce20d.i2iStrength ?? 0.7);
              _0x57037e.noise = Number(_0x2ce20d.i2iNoise ?? 0);
            }
          }
          const _0x13e8ee = {
            input: _0x373a57,
            model: _0x17d922,
            action: _0xdb1ebf,
            parameters: _0x57037e
          };
          const _0xe7ba19 = _0x13e8ee;
          this.ctx.log("image-gen", "NAI 官方格式 Payload (action=" + _0xdb1ebf + ", model=" + _0x17d922 + "):", _0xe7ba19);
          let _0xc2662f;
          let _0x48124c = false;
          try {
            this.ctx.log("image-gen", "尝试请求: " + _0x26cbe8);
            _0xc2662f = await fetch(_0x26cbe8, {
              method: "POST",
              headers: {
                Authorization: "Bearer " + _0x2ce20d.apiKey,
                "Content-Type": "application/json"
              },
              body: JSON.stringify(_0xe7ba19)
            });
          } catch (_0x23f894) {
            _0x48124c = true;
            this.ctx.log("image-gen", "第一次请求失败 (" + _0x26cbe8 + ")，尝试回退: " + _0x23f894.message);
          }
          if ((_0x48124c || !_0xc2662f?.ok) && _0x242765 !== _0x5ae564) {
            try {
              _0x26cbe8 = _0x5ae564;
              this.ctx.log("image-gen", "回退尝试请求: " + _0x26cbe8);
              const _0x6b8c1f = {
                Authorization: "Bearer " + _0x2ce20d.apiKey,
                "Content-Type": "application/json"
              };
              _0xc2662f = await fetch(_0x26cbe8, {
                method: "POST",
                headers: _0x6b8c1f,
                body: JSON.stringify(_0xe7ba19)
              });
              _0x48124c = false;
            } catch (_0x276ad5) {
              const _0x305c1e = {
                url: _0x26cbe8,
                error: _0x276ad5.message,
                hint: "请检查网络连接或反代地址是否正确"
              };
              this.ctx.helpers.userError("NAI网络请求失败 (官方/自定义)", _0x305c1e);
              throw _0x276ad5;
            }
          }
          if (_0x48124c || !_0xc2662f?.ok) {
            if (_0x48124c) {
              throw new Error("NAI网络请求失败，请检查网络连接");
            }
            const _0x9f37d2 = await _0xc2662f.text();
            let _0x3d1edf = _0x9f37d2;
            try {
              const _0x1620cb = JSON.parse(_0x9f37d2);
              _0x3d1edf = "(" + _0x1620cb.statusCode + ") " + _0x1620cb.message;
            } catch (_0x14efb8) {}
            throw new Error("NAI API 错误 (" + _0xc2662f.status + "): " + _0x3d1edf);
          }
          const _0x292dee = await _0xc2662f.blob();
          const _0x526faf = await this._unzipNAIResponse(_0x292dee);
          _0x4dc14c = "data:image/png;base64," + _0x526faf;
          if (_0x2ce20d.emotions) {
            const _0x3b83ec = this._detectNaiEmotion(_0x373a57, _0x2ce20d.emotions);
            if (_0x3b83ec && _0x4dc14c) {
              this.ctx.log("image-gen", "[自动触发] 检测到情绪: " + _0x3b83ec.key + "，开始应用...");
              this.ctx.helpers.showToast("应用情绪: " + _0x3b83ec.key + "...", "info");
              try {
                const _0x315f7d = new Image();
                await new Promise(_0x9c6d19 => {
                  _0x315f7d.onload = _0x9c6d19;
                  _0x315f7d.src = _0x4dc14c;
                });
                const {
                  naturalWidth: _0x5f1171,
                  naturalHeight: _0x4e29fa
                } = _0x315f7d;
                const _0x47092c = await this.applyNaiEmotion(_0x4dc14c, _0x3b83ec, _0x5f1171, _0x4e29fa);
                if (_0x47092c) {
                  _0x4dc14c = "data:image/png;base64," + _0x47092c;
                  this.ctx.log("image-gen", "自动情绪重绘完成");
                }
              } catch (_0x5499d7) {
                this.ctx.error("image-gen", "自动情绪重绘失败:", _0x5499d7);
                this.ctx.helpers.showToast("情绪应用失败: " + _0x5499d7.message, "error");
              }
            }
          }
        } else {
          this.ctx.log("image-gen", "使用 SillyTavern 内置 NAI 代理 (/api/novelai/generate-image)");
          const _0x21ae4f = await fetch("/api/novelai/generate-image", {
            method: "POST",
            headers: getRequestHeaders(),
            body: JSON.stringify({
              prompt: _0x373a57,
              model: _0x3137dd?.model || _0x2ce20d.model || "nai-diffusion-3",
              sampler: _0x3137dd?.sampler || _0x2ce20d.sampler || "k_euler_ancestral",
              scheduler: _0x3137dd?.noiseSchedule || _0x2ce20d.noiseSchedule || "karras",
              steps: Number(_0x3137dd?.steps || _0x2ce20d.steps) || 28,
              scale: Number(_0x3137dd?.scale || _0x2ce20d.scale) || 5,
              width: _0x69e167,
              height: _0x124289,
              negative_prompt: _0x3f205a,
              decrisper: _0x2ce20d.decrisper === true,
              variety_boost: _0x2ce20d.variety !== false,
              sm: _0x2ce20d.sm === true,
              sm_dyn: _0x2ce20d.dyn === true && _0x2ce20d.sm === true,
              seed: _0x3ab8dd
            })
          });
          if (!_0x21ae4f.ok) {
            const _0x28f066 = await _0x21ae4f.text();
            throw new Error("NAI API 错误 (" + _0x21ae4f.status + "): " + _0x28f066);
          }
          const _0xd4623e = await _0x21ae4f.text();
          _0x4dc14c = "data:image/png;base64," + _0xd4623e;
        }
      } else {
        const _0x1422bd = ImageGenerator.DEFAULT_NAI_PROXY_URL;
        const _0x49ab33 = this._removeTrailingSlash(_0x2ce20d.proxyUrl || _0x1422bd);
        if (!_0x2ce20d.apiKey) {
          throw new Error("请先在设置中配置 NovelAI API Key (用于第三方代理)");
        }
        const _0x5e4030 = _0x2ce20d.proxyStream !== false;
        this.ctx.log("image-gen", "NAI 代理请求: URL=" + _0x49ab33 + ", 流式=" + _0x5e4030);
        let _0x5a1015 = _0x2ce20d.sizePreset || "竖图";
        if (_0x3137dd?.width && _0x3137dd?.height) {
          _0x5a1015 = _0x3137dd.width + "x" + _0x3137dd.height;
        } else if (_0x2d89e3.buttonEl?._isExternalApi) {
          _0x5a1015 = _0x69e167 + "x" + _0x124289;
        } else if (_0x2ce20d.width && _0x2ce20d.height && (!_0x2ce20d.sizePreset || _0x2ce20d.sizePreset === "Custom")) {
          _0x5a1015 = _0x69e167 + "x" + _0x124289;
        }
        const _0x9f377a = [];
        if (_0x2ce20d.vibeEnabled && _0x2ce20d.vibeImages?.length > 0) {
          _0x2ce20d.vibeImages.forEach(_0x2444e8 => {
            if (_0x2444e8.image) {
              _0x9f377a.push(_0x2444e8.image);
            }
          });
        }
        let _0x44e145 = _0x2ce20d.multiRoleList || [];
        _0xed06ba = _0x373a57;
        const _0x46d311 = _0x2ce20d.multiRoleEnabled === true && MultiCharacterParser.isMultiCharacterPrompt(_0x465239);
        if (_0x46d311) {
          this.ctx.log("image-gen", "代理渠道：检测到多角色语法，构建 multiRoleList (优化版)");
          const _0x5f1f20 = MultiCharacterParser.parseScene(_0x465239);
          const _0x2944de = _0x5f1f20["Scene Composition"] || "";
          _0xed06ba = await this._buildPositivePrompt(_0x2944de, _0x33c644);
          _0x44e145 = [];
          const _0x4162ad = this.ctx.getModule("triggerProcessor");
          for (let _0x10955f = 1; _0x10955f <= 4; _0x10955f++) {
            let _0x1d8386 = _0x5f1f20["Character " + _0x10955f + " Prompt"];
            if (_0x1d8386) {
              if (_0x4162ad) {
                _0x1d8386 = this._cleanPromptText(_0x1d8386);
                _0x1d8386 = await _0x4162ad.processTriggers(_0x1d8386, true);
              }
              let _0x5747e2 = _0x5f1f20["Character " + _0x10955f + " UC"] || "";
              if (_0x4162ad && _0x5747e2) {
                _0x5747e2 = this._cleanPromptText(_0x5747e2);
                _0x5747e2 = await _0x4162ad.processTriggers(_0x5747e2, true);
              }
              const _0x385883 = _0x5f1f20["Character " + _0x10955f + " centers"] || "";
              _0x44e145.push({
                prompt: _0x1d8386,
                negativePrompt: _0x5747e2,
                position: _0x385883.toUpperCase()
              });
            }
          }
        } else if (MultiCharacterParser.isMultiCharacterPrompt(_0x465239)) {
          this.ctx.log("image-gen", "代理渠道：检测到多角色语法但未启用，将平铺为普通 Tags");
          const _0xab8a80 = MultiCharacterParser.flattenMultiCharacterPrompt(_0x465239);
          _0xed06ba = await this._buildPositivePrompt(_0xab8a80, _0x33c644);
        }
        let _0x5efa1c = _0x2ce20d.i2iBase64 || null;
        if (_0x4cdc84) {
          _0x5efa1c = this._extractBase64(_0x43815d);
        }
        const _0x2b36b7 = {
          imageToImageBase64: null,
          vibeTransferList: [],
          multiRoleList: _0x44e145,
          characterKeep: null
        };
        const _0x547f72 = {
          token: _0x2ce20d.apiKey,
          model: _0x3137dd?.model || _0x2ce20d.model,
          sampler: _0x3137dd?.sampler || _0x2ce20d.sampler,
          noise_schedule: _0x3137dd?.noiseSchedule || _0x2ce20d.noiseSchedule,
          size: _0x5a1015,
          steps: String(_0x3137dd?.steps || _0x2ce20d.steps || 28),
          scale: String(_0x3137dd?.scale || _0x2ce20d.scale || 5),
          cfg: String(_0x2ce20d.cfgRescale || 0),
          stream: _0x5e4030 ? 1 : 0,
          nocache: 1,
          tag: _0xed06ba,
          negative: _0x3f205a,
          seed: _0x3137dd?.seed !== undefined && _0x3137dd?.seed !== -1 ? _0x3137dd.seed : _0x3ab8dd,
          addition: _0x2b36b7
        };
        if (_0x4cdc84) {
          _0x547f72.addition.imageToImageBase64 = _0x43815d;
          _0x547f72.i2iforce = String(_0x2ce20d.i2iStrength ?? 0.7);
          _0x547f72.i2icl = "1";
          if (_0x21dd16) {
            _0x547f72.mask = this._extractBase64(_0x4637c9);
            _0x547f72.inpaintStrength = String(_0x2ce20d.inpaintStrength ?? 1);
          }
        }
        if (_0x2ce20d.vibeEnabled && _0x2ce20d.vibeImages?.length > 0) {
          if (_0x2ce20d.referenceMode === "director") {
            const _0x415be2 = _0x2ce20d.vibeImages[0];
            if (_0x415be2) {
              const _0x4877ac = _0x415be2.image || _0x415be2.base64 || "";
              const _0x47f5d9 = await this._resolveImageToDataURL(_0x4877ac);
              if (_0x47f5d9) {
                const _0x333ce7 = await this._processDirectorImage(_0x47f5d9);
                _0x547f72.addition.characterKeep = {
                  base64: _0x333ce7,
                  keepVibe: _0x2ce20d.directorStyleAware === true,
                  strength: parseFloat(_0x2ce20d.directorStrength || 0.6)
                };
              } else {
                this.ctx.log("image-gen", "无法加载 CharacterKeep 参考图，跳过。");
                _0x547f72.addition.characterKeep = null;
              }
            }
          } else {
            const _0x590574 = [];
            for (const _0x5af5b6 of _0x2ce20d.vibeImages) {
              if (_0x5af5b6.type === "vibeFile") {
                continue;
              }
              const _0x519112 = _0x5af5b6.image || _0x5af5b6.base64 || "";
              const _0x29f1c6 = await this._resolveImageToDataURL(_0x519112);
              if (_0x29f1c6) {
                const _0xb83a17 = this._extractBase64(_0x29f1c6);
                _0x590574.push({
                  base64: _0xb83a17,
                  infoExtract: parseFloat(_0x5af5b6.infoExtracted ?? 1),
                  refStrength: parseFloat(_0x5af5b6.strength ?? 0.6)
                });
              }
            }
            _0x547f72.addition.vibeTransferList = _0x590574;
            _0x547f72.addition.characterKeep = null;
            this.ctx.log("image-gen", "Proxy VibeList:", _0x590574.length);
          }
        }
        this.ctx.log("image-gen", "NAI proxy (POST) Payload:", _0x547f72);
        let _0x43e764;
        try {
          _0x43e764 = await fetch(_0x49ab33, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + _0x2ce20d.apiKey
            },
            body: JSON.stringify(_0x547f72)
          });
        } catch (_0x39b9ec) {
          const _0x2d938a = {
            url: _0x49ab33,
            error: _0x39b9ec.message,
            hint: "请检查代理地址是否需要魔法上网，或代理已失效"
          };
          this.ctx.helpers.userError("NAI网络请求失败 (第三方代理)", _0x2d938a);
          throw _0x39b9ec;
        }
        if (!_0x43e764.ok) {
          const _0x15acfc = await _0x43e764.text();
          throw new Error("代理 API 错误 (" + _0x43e764.status + "): " + _0x15acfc);
        }
        if (_0x5e4030) {
          const _0x28f5ac = await _0x43e764.text();
          this.ctx.log("image-gen", "代理响应原文:", _0x28f5ac.substring(0, 500));
          const _0xcc2fe3 = _0x28f5ac.trim().split("\n");
          let _0x39b5b2 = "";
          for (let _0x55a789 = _0xcc2fe3.length - 1; _0x55a789 >= 0; _0x55a789--) {
            try {
              const _0xca8681 = JSON.parse(_0xcc2fe3[_0x55a789]);
              _0x39b5b2 = _0xca8681.url || _0xca8681.imageUrl || _0xca8681.data?.url || "";
              if (_0x39b5b2) {
                this.ctx.log("image-gen", "从流式响应解析到URL:", _0x39b5b2);
                break;
              }
            } catch {
              continue;
            }
          }
          if (!_0x39b5b2) {
            try {
              const _0x197222 = JSON.parse(_0x28f5ac);
              _0x39b5b2 = _0x197222.url || _0x197222.imageUrl || _0x197222.data?.url || "";
            } catch {}
          }
          if (!_0x39b5b2) {
            throw new Error("代理响应未提供图片 URL");
          }
          const _0x58a8b1 = _0x39b5b2.startsWith("http") ? _0x39b5b2 : "" + new URL(_0x49ab33).origin + _0x39b5b2;
          this.ctx.log("image-gen", "代理流式POST请求成功, 正在从以下地址获取图片:", _0x58a8b1);
          const _0x406330 = await fetch(_0x58a8b1);
          if (!_0x406330.ok) {
            throw new Error("代理图片获取失败: " + _0x406330.status);
          }
          const _0xe61d22 = await _0x406330.blob();
          _0x4dc14c = await this._blobToDataURL(_0xe61d22);
        } else {
          const _0xf3f6f8 = _0x43e764.headers.get("content-type") || "";
          this.ctx.log("image-gen", "NAI代理非流式响应 Content-Type: " + _0xf3f6f8);
          if (_0xf3f6f8.includes("application/json") || _0xf3f6f8.includes("text/")) {
            const _0x4a052e = await _0x43e764.text();
            this.ctx.log("image-gen", "检测到非流式 JSON/Text 响应: " + _0x4a052e.substring(0, 300));
            let _0x420c33 = "";
            try {
              let _0x2fd400 = JSON.parse(_0x4a052e.trim());
              if (typeof _0x2fd400 === "string") {
                this.ctx.log("image-gen", "检测到双重编码 JSON，进行第二次解析。");
                _0x2fd400 = JSON.parse(_0x2fd400.trim());
              }
              _0x420c33 = _0x2fd400.url || _0x2fd400.imageUrl || _0x2fd400.data?.url || _0x2fd400.output || "";
            } catch (_0x14a82d) {
              this.ctx.error("image-gen", "解析非流式 JSON 失败", _0x14a82d);
              throw new Error("代理返回了无效的JSON: " + _0x4a052e.substring(0, 100));
            }
            if (_0x420c33) {
              const _0x281da5 = new URL(_0x49ab33).origin;
              const _0x328506 = _0x420c33.startsWith("http") ? _0x420c33 : "" + _0x281da5 + _0x420c33;
              this.ctx.log("image-gen", "从 JSON 获取到链接，开始下载图片: " + _0x328506);
              const _0x353f54 = await fetch(_0x328506);
              if (!_0x353f54.ok) {
                throw new Error("下载代理生成的图片失败 (" + _0x353f54.status + ")");
              }
              const _0x3fb9d7 = await _0x353f54.blob();
              _0x4dc14c = await this._blobToDataURL(_0x3fb9d7);
            } else {
              throw new Error("代理返回了 JSON 但未找到图片地址: " + _0x4a052e.substring(0, 100));
            }
          } else {
            const _0x14efeb = await _0x43e764.blob();
            _0x4dc14c = await this._blobToDataURL(_0x14efeb);
          }
        }
      }
      const _0x35137e = _0x2ce20d.channel === "proxy" ? _0xed06ba : _0x373a57;
      const _0xdd3069 = {
        success: true,
        imageUrl: _0x4dc14c,
        finalPositive: _0x35137e,
        finalNegative: _0x3f205a
      };
      return _0xdd3069;
    } catch (_0x225b91) {
      throw new Error("NAI 生成失败: " + _0x225b91.message);
    }
  }
  async _unzipNAIResponse(_0x7ba5ff) {
    try {
      if (!window.JSZip) {
        const _0x294d95 = window.define;
        const _0x43a2ba = window.define?.amd;
        try {
          if (typeof window.define === "function" && window.define.amd) {
            delete window.define.amd;
          }
          await import("../data/jszip.min.js");
        } finally {
          if (_0x43a2ba && typeof window.define === "function") {
            window.define.amd = _0x43a2ba;
          }
        }
      }
      const _0x15f531 = await _0x7ba5ff.arrayBuffer();
      const _0x46b2fd = await window.JSZip.loadAsync(_0x15f531);
      const _0x3e197f = Object.values(_0x46b2fd.files).find(_0x1acb5 => !_0x1acb5.dir && (_0x1acb5.name.endsWith(".png") || _0x1acb5.name.endsWith(".jpg") || _0x1acb5.name.endsWith(".webp")));
      if (!_0x3e197f) {
        throw new Error("ZIP 文件中未找到图片");
      }
      const _0x22c65c = await _0x3e197f.async("base64");
      this.ctx.log("image-gen", "从 ZIP 中提取图片: " + _0x3e197f.name + ", 大小: " + _0x22c65c.length + " 字符");
      return _0x22c65c;
    } catch (_0x5d3c7c) {
      this.ctx.helpers.userError("NAI 图片解压失败", _0x5d3c7c);
      this.ctx.error("image-gen", "ZIP 解压失败:", _0x5d3c7c);
      throw new Error("无法从 ZIP 中提取图片: " + _0x5d3c7c.message);
    }
  }
  _detectNaiEmotion(_0x1dced3, _0xdc3e5f) {
    if (!_0xdc3e5f || !_0x1dced3) {
      return null;
    }
    const _0x1a293c = _0x1dced3.toLowerCase();
    for (const [_0x3cf3b3, _0x470ea3] of Object.entries(_0xdc3e5f)) {
      if (!_0x470ea3.triggers) {
        continue;
      }
      const _0x5eea2a = _0x470ea3.triggers.split(",").map(_0x52b48e => _0x52b48e.trim().toLowerCase()).filter(Boolean);
      for (const _0x2ee2b0 of _0x5eea2a) {
        if (_0x1a293c.includes(_0x2ee2b0)) {
          const _0xd303e7 = {
            key: _0x3cf3b3,
            strength: _0x470ea3.strength
          };
          return _0xd303e7;
        }
      }
    }
    return null;
  }
  async applyNaiEmotion(_0x1db151, _0x4c4cc9, _0x431cf6, _0x55db08) {
    const _0x5782ae = this.settings.nai;
    if (_0x5782ae.channel === "proxy") {
      return await this._applyNaiEmotionProxy(_0x1db151, _0x4c4cc9, _0x431cf6, _0x55db08);
    } else {
      return await this._applyNaiEmotionOfficial(_0x1db151, _0x4c4cc9, _0x431cf6, _0x55db08);
    }
  }
  async _applyNaiEmotionProxy(_0x3f1685, _0xcaa271, _0x52386e, _0xb33a55) {
    const _0x102d5d = this.settings.nai;
    const _0x4caa3a = this._removeTrailingSlash(_0x102d5d.proxyUrl || ImageGenerator.DEFAULT_NAI_PROXY_URL);
    const _0x18a4f0 = {
      model: "director",
      token: _0x102d5d.apiKey,
      params: {
        req_type: "emotion",
        defry: String(parseInt(_0xcaa271.strength) || 0),
        img: _0x3f1685,
        width: _0x52386e,
        height: _0xb33a55,
        prompt: _0xcaa271.key.toLowerCase() + ";; "
      },
      nocache: 1,
      stream: 0
    };
    this.ctx.log("image-gen", "Proxy Emotion Payload:", _0x18a4f0);
    const _0x13c01a = await fetch(_0x4caa3a, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(_0x18a4f0)
    });
    if (!_0x13c01a.ok) {
      const _0x2f7ad8 = await _0x13c01a.text();
      throw new Error("Proxy Emotion API Error (" + _0x13c01a.status + "): " + _0x2f7ad8);
    }
    const _0x1a7e8c = _0x13c01a.headers.get("content-type") || "";
    this.ctx.log("image-gen", "Proxy Emotion Content-Type: " + _0x1a7e8c);
    if (_0x1a7e8c.includes("application/json") || _0x1a7e8c.includes("text/")) {
      const _0x24e639 = await _0x13c01a.text();
      this.ctx.log("image-gen", "Proxy Emotion JSON Response: " + _0x24e639.substring(0, 300));
      let _0x3a329b = "";
      try {
        let _0x6f1bb0 = JSON.parse(_0x24e639.trim());
        if (typeof _0x6f1bb0 === "string") {
          _0x6f1bb0 = JSON.parse(_0x6f1bb0.trim());
        }
        _0x3a329b = _0x6f1bb0.url || _0x6f1bb0.imageUrl || _0x6f1bb0.data?.url || _0x6f1bb0.output || "";
      } catch (_0x4148ab) {
        this.ctx.error("image-gen", "解析 Proxy Emotion JSON 失败", _0x4148ab);
        throw new Error("代理返回了无效的JSON: " + _0x24e639.substring(0, 100));
      }
      if (_0x3a329b) {
        const _0x5ee8e0 = new URL(_0x4caa3a).origin;
        const _0x4c1fc9 = _0x3a329b.startsWith("http") ? _0x3a329b : "" + _0x5ee8e0 + _0x3a329b;
        this.ctx.log("image-gen", "从 Proxy Emotion 获取到链接，开始下载图片: " + _0x4c1fc9);
        const _0x5e3150 = await fetch(_0x4c1fc9);
        if (!_0x5e3150.ok) {
          throw new Error("下载代理情绪重绘图片失败 (" + _0x5e3150.status + ")");
        }
        const _0x3a9ce5 = await _0x5e3150.blob();
        const _0x56d26b = await this._blobToDataURL(_0x3a9ce5);
        return this._extractBase64(_0x56d26b);
      } else {
        throw new Error("代理返回了 JSON 但未找到图片地址: " + _0x24e639.substring(0, 100));
      }
    } else {
      const _0x348e2f = await _0x13c01a.blob();
      const _0x1567dd = await this._blobToDataURL(_0x348e2f);
      return this._extractBase64(_0x1567dd);
    }
  }
  async _applyNaiEmotionOfficial(_0x2138f7, _0x1f5ba5, _0x49ffa2, _0x155bed) {
    const _0x453aa7 = this.settings.nai;
    const _0x3342b2 = (_0x453aa7.proxyUrl || this.DEFAULT_NAI_OFFICIAL_URL).replace("generate-image", "augment-image");
    const _0x4ab9ef = {
      req_type: "emotion",
      use_new_shared_trial: true,
      prompt: _0x1f5ba5.key.toLowerCase() + ";;",
      defry: parseInt(_0x1f5ba5.strength) || 0,
      width: _0x49ffa2,
      height: _0x155bed,
      image: this._extractBase64(_0x2138f7)
    };
    this.ctx.log("image-gen", "Official Emotion Payload:", _0x4ab9ef);
    const _0x54d961 = await fetch(_0x3342b2, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + _0x453aa7.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(_0x4ab9ef)
    });
    if (!_0x54d961.ok) {
      const _0x370689 = await _0x54d961.text();
      throw new Error("Emotion API Error (" + _0x54d961.status + "): " + _0x370689);
    }
    const _0x5c667b = await _0x54d961.blob();
    return await this._unzipNAIResponse(_0x5c667b);
  }
  async applyNaiDeclutter(_0xe916c1, _0x1c6e39, _0x481aa4) {
    const _0x1b5111 = this.settings.nai;
    if (_0x1b5111.channel === "proxy") {
      return await this._applyNaiDeclutterProxy(_0xe916c1, _0x1c6e39, _0x481aa4);
    } else {
      return await this._applyNaiDeclutterOfficial(_0xe916c1, _0x1c6e39, _0x481aa4);
    }
  }
  async _applyNaiDeclutterProxy(_0x421539, _0x3bacd3, _0x1ce488) {
    const _0x1bb686 = this.settings.nai;
    const _0x1f4033 = this._removeTrailingSlash(_0x1bb686.proxyUrl || ImageGenerator.DEFAULT_NAI_PROXY_URL);
    const _0x4b911d = {
      req_type: "declutter",
      defry: "5",
      img: _0x421539,
      width: _0x3bacd3,
      height: _0x1ce488
    };
    const _0x4f684c = {
      model: "director",
      token: _0x1bb686.apiKey,
      params: _0x4b911d,
      nocache: 1,
      stream: 0
    };
    const _0x499090 = _0x4f684c;
    this.ctx.log("image-gen", "Proxy Declutter Payload:", _0x499090);
    const _0x20f4f8 = await fetch(_0x1f4033, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(_0x499090)
    });
    if (!_0x20f4f8.ok) {
      const _0x464a57 = await _0x20f4f8.text();
      throw new Error("Proxy Declutter API Error (" + _0x20f4f8.status + "): " + _0x464a57);
    }
    const _0xe94b1f = _0x20f4f8.headers.get("content-type") || "";
    this.ctx.log("image-gen", "Proxy Declutter Content-Type: " + _0xe94b1f);
    if (_0xe94b1f.includes("application/json") || _0xe94b1f.includes("text/")) {
      const _0x1217d6 = await _0x20f4f8.text();
      this.ctx.log("image-gen", "Proxy Declutter JSON Response: " + _0x1217d6.substring(0, 300));
      let _0x323250 = "";
      try {
        let _0x8ef879 = JSON.parse(_0x1217d6.trim());
        if (typeof _0x8ef879 === "string") {
          _0x8ef879 = JSON.parse(_0x8ef879.trim());
        }
        _0x323250 = _0x8ef879.url || _0x8ef879.imageUrl || _0x8ef879.data?.url || _0x8ef879.output || "";
      } catch (_0x134cbe) {
        this.ctx.error("image-gen", "解析 Proxy Declutter JSON 失败", _0x134cbe);
        throw new Error("代理返回了无效的JSON: " + _0x1217d6.substring(0, 100));
      }
      if (_0x323250) {
        const _0x2859ac = new URL(_0x1f4033).origin;
        const _0x3c79b9 = _0x323250.startsWith("http") ? _0x323250 : "" + _0x2859ac + _0x323250;
        this.ctx.log("image-gen", "从 Proxy Declutter 获取到链接，开始下载图片: " + _0x3c79b9);
        const _0x7ee4dd = await fetch(_0x3c79b9);
        if (!_0x7ee4dd.ok) {
          throw new Error("下载代理去除文字图片失败 (" + _0x7ee4dd.status + ")");
        }
        const _0x3a9f01 = await _0x7ee4dd.blob();
        const _0x39fa7b = await this._blobToDataURL(_0x3a9f01);
        return this._extractBase64(_0x39fa7b);
      } else {
        throw new Error("代理返回了 JSON 但未找到图片地址: " + _0x1217d6.substring(0, 100));
      }
    } else {
      const _0x1ff7e5 = await _0x20f4f8.blob();
      const _0x372435 = await this._blobToDataURL(_0x1ff7e5);
      return this._extractBase64(_0x372435);
    }
  }
  async _applyNaiDeclutterOfficial(_0x2f486f, _0x32b284, _0x17a7d4) {
    const _0x38add9 = this.settings.nai;
    const _0x287e75 = (_0x38add9.proxyUrl || this.DEFAULT_NAI_OFFICIAL_URL).replace("generate-image", "augment-image");
    const _0x3364b8 = {
      req_type: "declutter",
      use_new_shared_trial: true,
      width: _0x32b284,
      height: _0x17a7d4,
      image: this._extractBase64(_0x2f486f)
    };
    this.ctx.log("image-gen", "Official Declutter Payload:", _0x3364b8);
    const _0x492d1a = await fetch(_0x287e75, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + _0x38add9.apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(_0x3364b8)
    });
    if (!_0x492d1a.ok) {
      const _0x2bd5d3 = await _0x492d1a.text();
      throw new Error("Declutter API Error (" + _0x492d1a.status + "): " + _0x2bd5d3);
    }
    const _0x4eceaf = await _0x492d1a.blob();
    return await this._unzipNAIResponse(_0x4eceaf);
  }
  async _applyNaiTriggerOverrides(_0x26bc81, _0x1350d0) {
    if (!_0x1350d0.naiTriggersEnabled) {
      return _0x1350d0;
    }
    if (_0x1350d0.vibeEnabled) {
      this.ctx.log("image-gen", "手动参考模式已开启，跳过触发词检测。");
      return _0x1350d0;
    }
    const _0x5ba54e = _0x1350d0.naiPresets || [];
    if (_0x5ba54e.length === 0) {
      return _0x1350d0;
    }
    for (const _0x274d59 of _0x5ba54e) {
      if (!_0x274d59.triggerWords) {
        continue;
      }
      const _0x321b5b = _0x274d59.triggerWords.split(",").map(_0x6e6df6 => _0x6e6df6.trim()).filter(Boolean);
      if (_0x321b5b.length === 0) {
        continue;
      }
      for (const _0x1bf310 of _0x321b5b) {
        if (_0x26bc81.toLowerCase().includes(_0x1bf310.toLowerCase())) {
          this.ctx.log("image-gen", "NAI 触发词命中: \"" + _0x1bf310 + "\" -> 激活预设 \"" + _0x274d59.name + "\"");
          const _0x263406 = JSON.parse(JSON.stringify(_0x1350d0));
          _0x263406.vibeEnabled = true;
          _0x263406.referenceMode = _0x274d59.referenceMode || "vibe";
          _0x263406.vibeImages = _0x274d59.images || [];
          _0x263406.directorStyleAware = _0x274d59.directorStyleAware || false;
          _0x263406.directorStrength = _0x274d59.directorStrength || 0.6;
          return _0x263406;
        }
      }
    }
    return _0x1350d0;
  }
  _detectNaiEmotion(_0xd5d852, _0xacafe6) {
    if (!_0xacafe6 || !_0xd5d852) {
      return null;
    }
    const _0xe6db6 = _0xd5d852.toLowerCase();
    for (const [_0x2a0ff4, _0x37ef85] of Object.entries(_0xacafe6)) {
      if (!_0x37ef85.triggers) {
        continue;
      }
      const _0x4d77b6 = _0x37ef85.triggers.split(",").map(_0x5bd683 => _0x5bd683.trim().toLowerCase()).filter(Boolean);
      for (const _0x5c96a9 of _0x4d77b6) {
        if (_0xe6db6.includes(_0x5c96a9)) {
          const _0x350972 = {
            key: _0x2a0ff4,
            strength: _0x37ef85.strength
          };
          return _0x350972;
        }
      }
    }
    return null;
  }
  async _applyNaiEmotion(_0x3c334b, _0x1e2cd1, _0x488893, _0x4e2f43, _0xb15ec, _0x2426e9) {
    const _0x134f28 = this._extractBase64(_0x3c334b);
    const _0x4eb0b7 = {
      req_type: "emotion",
      use_new_shared_trial: true,
      prompt: _0x1e2cd1.key.toLowerCase() + ";;",
      defry: parseInt(_0x1e2cd1.strength) || 0,
      width: _0x488893,
      height: _0x4e2f43,
      image: _0x134f28
    };
    this.ctx.log("image-gen", "Emotion Payload:", _0x4eb0b7);
    const _0x1c91ee = {
      Authorization: "Bearer " + _0xb15ec,
      "Content-Type": "application/json"
    };
    const _0x4b5de2 = await fetch(_0x2426e9, {
      method: "POST",
      headers: _0x1c91ee,
      body: JSON.stringify(_0x4eb0b7)
    });
    if (!_0x4b5de2.ok) {
      const _0x41f714 = await _0x4b5de2.text();
      throw new Error("Emotion API Error (" + _0x4b5de2.status + "): " + _0x41f714);
    }
    const _0x66a298 = await _0x4b5de2.blob();
    return await this._unzipNAIResponse(_0x66a298);
  }
  async _blobToDataURL(_0x330cee) {
    return new Promise((_0x160057, _0x45174f) => {
      const _0x3b482f = new FileReader();
      _0x3b482f.onloadend = () => _0x160057(_0x3b482f.result);
      _0x3b482f.onerror = _0x45174f;
      _0x3b482f.readAsDataURL(_0x330cee);
    });
  }
  _dataURLtoBlob(_0x378edd) {
    if (!_0x378edd) {
      return null;
    }
    if (_0x378edd instanceof Blob) {
      return _0x378edd;
    }
    try {
      if (typeof _0x378edd !== "string") {
        return null;
      }
      var _0x129500 = _0x378edd.split(",");
      var _0x41a93a = _0x129500[0].match(/:(.*?);/)[1];
      var _0x1a7341 = atob(_0x129500[1]);
      var _0xc1ceb6 = _0x1a7341.length;
      var _0x3ef75e = new Uint8Array(_0xc1ceb6);
      while (_0xc1ceb6--) {
        _0x3ef75e[_0xc1ceb6] = _0x1a7341.charCodeAt(_0xc1ceb6);
      }
      const _0x2eae8b = {
        type: _0x41a93a
      };
      return new Blob([_0x3ef75e], _0x2eae8b);
    } catch (_0x446c4b) {
      console.error("Base64 转 Blob 失败:", _0x446c4b);
      return null;
    }
  }
  async _decryptComfyUIImage(_dataUrl, _psw) {
    const _sha256 = async (input) => {
      const d = new TextEncoder().encode(input);
      const h = await crypto.subtle.digest('SHA-256', d);
      return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
    };
    const _getRange = (input, offset, rangeLen = 4) => {
      offset = offset % input.length;
      return (input + input).substring(offset, offset + rangeLen);
    };
    const _shuffleArr = (arr, shaKey) => {
      const arrLen = arr.length;
      for (let i = 0; i < arrLen; i++) {
        const toIndex = parseInt(_getRange(shaKey, i, 8), 16) % (arrLen - i);
        [arr[i], arr[toIndex]] = [arr[toIndex], arr[i]];
      }
    };
    const k0 = await _sha256(_psw);
    const k1 = await _sha256(k0);
    const k2 = await _sha256(k1);
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = _dataUrl; });
    const W = img.width, H = img.height;
    const cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = H;
    const ctx = cvs.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const imgData = ctx.getImageData(0, 0, W, H);
    const px = imgData.data;
    const xArr = Array.from({length: W}, (_, i) => i);
    _shuffleArr(xArr, k1);
    const yArr = Array.from({length: H}, (_, i) => i);
    _shuffleArr(yArr, k2);
    const tmp = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4, d = (x * H + y) * 4;
      tmp[d] = px[s]; tmp[d+1] = px[s+1]; tmp[d+2] = px[s+2]; tmp[d+3] = px[s+3];
    }
    for (let x = W - 1; x >= 0; x--) {
      const _x = xArr[x]; if (x === _x) continue;
      for (let y = 0; y < H; y++) {
        const a = (x * H + y) * 4, b = (_x * H + y) * 4;
        for (let c = 0; c < 4; c++) { const t = tmp[a+c]; tmp[a+c] = tmp[b+c]; tmp[b+c] = t; }
      }
    }
    const out = new Uint8ClampedArray(W * H * 4);
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      const s = (x * H + y) * 4, d = (y * W + x) * 4;
      out[d] = tmp[s]; out[d+1] = tmp[s+1]; out[d+2] = tmp[s+2]; out[d+3] = tmp[s+3];
    }
    for (let y = H - 1; y >= 0; y--) {
      const _y = yArr[y]; if (y === _y) continue;
      for (let x = 0; x < W; x++) {
        const a = (y * W + x) * 4, b = (_y * W + x) * 4;
        for (let c = 0; c < 4; c++) { const t = out[a+c]; out[a+c] = out[b+c]; out[b+c] = t; }
      }
    }
    ctx.putImageData(new ImageData(out, W, H), 0, 0);
    return cvs.toDataURL('image/png');
  }
  async generateWithComfyUI(_0x300fda, _0x149794, _0x57d3d2 = {}) {
    const _0x56cce5 = this.settings.comfyui;
    const _0x1b53e6 = this.ctx.getModule("triggerProcessor");
    if (_0x1b53e6) {
      _0x300fda = await _0x1b53e6.processTriggers(_0x300fda);
      if (_0x149794) {
        _0x149794 = await _0x1b53e6.processTriggers(_0x149794);
      }
    }
    const {
      i2iEnabled: _0x45801a,
      i2iImage: _0x4f452c,
      i2iMask: _0x1c17b3
    } = _0x57d3d2;
    const _0x20dfa1 = _0x56cce5.apiMode || "direct";
    const _0x30bb6f = _0x45801a && _0x4f452c;
    if (!_0x56cce5.url) {
      throw new Error("请先配置 ComfyUI URL");
    }
    let _0x15f66d = _0x56cce5.activeWorkflow;
    if (_0x57d3d2.comfyuiWorkflow) {
      _0x15f66d = _0x57d3d2.comfyuiWorkflow;
      this.ctx.log("image-gen", "使用指定的 ComfyUI 工作流: " + _0x15f66d);
    } else if (_0x30bb6f && _0x56cce5.i2iWorkflow) {
      _0x15f66d = _0x56cce5.i2iWorkflow;
      this.ctx.log("image-gen", "自动切换图生图工作流: " + _0x15f66d);
    }
    if (!_0x15f66d) {
      throw new Error("请先选择一个 ComfyUI 工作流");
    }
    const _0xbfe766 = this._removeTrailingSlash(_0x56cce5.url);
    this.ctx.log("image-gen", "ComfyUI 生成: " + _0xbfe766 + " (img2img=" + _0x30bb6f + ") [模式:" + _0x20dfa1 + "]");
    const _0x56d1db = await this._getComfyUIWorkflow(_0x15f66d);
    if (!_0x56d1db) {
      throw new Error("未找到指定的工作流");
    }
    const _0x4aeea7 = _0x56cce5.apiKey;
    const _0x384e2b = {
      ..._0x57d3d2
    };
    _0x384e2b.apiKey = _0x4aeea7;
    const _0x3d5b51 = {
      i2iEnabled: _0x30bb6f,
      i2iImage: _0x4f452c,
      i2iMask: _0x1c17b3,
      externalOptions: _0x384e2b
    };
    const {
      workflow: _0x167cd6,
      positive: _0x2cd296,
      negative: _0x4edc4f
    } = await this._processComfyUIWorkflow(_0x56d1db, _0x300fda, _0x149794, _0x3d5b51);
    if (!this.isGenerationInProgress) {
      await this._sleep(1000);
    }
    this.isGenerationInProgress = false;
    try {
      const _0x534b4a = Math.random().toString(36).substring(2);
      const _0x518943 = () => {
        const _0x3718a9 = getRequestHeaders();
        if (_0x4aeea7) {
          _0x3718a9.Authorization = "Bearer " + _0x4aeea7;
        }
        return _0x3718a9;
      };
      if (_0x20dfa1 === "original") {
        this.ctx.log("image-gen", "使用原生模式 (ST Proxy) 请求 ComfyUI");
        const _0x1e731d = {
          client_id: _0x534b4a,
          prompt: _0x167cd6
        };
        const _0x37bdb4 = _0x1e731d;
        const _0x52a8d7 = {
          url: _0xbfe766,
          prompt: JSON.stringify(_0x37bdb4)
        };
        const _0x1471b5 = await fetch("/api/sd/comfy/generate", {
          method: "POST",
          headers: _0x518943(),
          body: JSON.stringify(_0x52a8d7)
        });
        if (!_0x1471b5.ok) {
          const _0x2be34e = await _0x1471b5.text();
          throw new Error("ST Proxy 错误 (" + _0x1471b5.status + "): " + _0x2be34e);
        }
        const _0x594f39 = await _0x1471b5.json();
        if (_0x594f39.data) {
          const _0x5af004 = _0x594f39.format || "png";
          const _0x9e7ad0 = ["png", "jpg", "jpeg", "webp", "bmp"];
          const _0x5dd0b6 = _0x9e7ad0.includes(_0x5af004.toLowerCase()) ? "image" : "video";
          const _0x375fdc = "data:" + _0x5dd0b6 + "/" + _0x5af004 + ";base64," + _0x594f39.data;
          const _decUrl = await this._decryptComfyUIImage(_0x375fdc, "123qwe");
          this.ctx.log("image-gen", "[原生模式] 已构建媒体URL, 类型: " + _0x5dd0b6 + "/" + _0x5af004);
          const _0xef0e4b = {
            success: true,
            imageUrl: _decUrl,
            finalPositive: _0x2cd296,
            finalNegative: _0x4edc4f
          };
          return _0xef0e4b;
        } else {
          throw new Error("ST Proxy 未返回图片数据");
        }
      } else {
        const _0x113c3f = {
          prompt: _0x167cd6,
          client_id: _0x534b4a
        };
        const _0xd3a8a5 = _0x113c3f;
        this.ctx.log("image-gen", "ComfyUI Direct payload:", _0xd3a8a5);
        const _0x3197d2 = {
          "Content-Type": "application/json"
        };
        if (_0x4aeea7) {
          _0x3197d2.Authorization = "Bearer " + _0x4aeea7;
        }
        const _0x56d744 = await fetch(_0xbfe766 + "/prompt", {
          method: "POST",
          headers: _0x3197d2,
          body: JSON.stringify(_0xd3a8a5)
        });
        let _0x12c5ef = null;
        try {
          _0x12c5ef = await _0x56d744.json();
        } catch (_0x36137a) {
          if (!_0x56d744.ok) {
            throw new Error("HTTP Error " + _0x56d744.status + ": " + _0x56d744.statusText);
          }
        }
        if (_0x12c5ef && (_0x12c5ef.error || _0x12c5ef.node_errors && Object.keys(_0x12c5ef.node_errors).length > 0)) {
          let _0x40f297 = "ComfyUI Error";
          let _0x48672e = "Unknown error occurred.";
          if (_0x12c5ef.error) {
            _0x40f297 = _0x12c5ef.error.type || _0x40f297;
            _0x48672e = _0x12c5ef.error.message || _0x48672e;
          }
          let _0x371443 = "ComfyUI 提交失败: " + _0x40f297 + " - " + _0x48672e;
          if (_0x12c5ef.node_errors) {
            for (const _0x5162b2 in _0x12c5ef.node_errors) {
              const _0x1545c0 = _0x12c5ef.node_errors[_0x5162b2];
              const _0x490b8e = _0x1545c0.class_type || "Unknown Node";
              const _0x5337a3 = _0x1545c0.errors || [];
              _0x5337a3.forEach(_0x2b3850 => {
                const _0x2726c1 = _0x2b3850.message || "Unknown error details";
                const _0x331048 = _0x2b3850.details ? " [" + _0x2b3850.details + "]" : "";
                _0x371443 += "\n节点 " + _0x5162b2 + " (" + _0x490b8e + "): " + _0x2726c1 + _0x331048;
              });
            }
          }
          const _0xcd38d6 = {
            summary: _0x371443,
            raw_response: _0x12c5ef
          };
          this.ctx.helpers.userError("ComfyUI 任务被拒绝 (详细堆栈)", _0xcd38d6);
          this.ctx.error("image-gen", _0x371443);
          throw new Error(_0x371443);
        }
        if (!_0x56d744.ok) {
          throw new Error("HTTP Error " + _0x56d744.status);
        }
        const _0x2740d1 = _0x12c5ef.prompt_id;
        let _0x5c9f2e = null;
        for (let _0x29d66f = 0; _0x29d66f < 600; _0x29d66f++) {
          await this._sleep(1000);
          try {
            const _0x17477b = await fetch(_0xbfe766 + "/history/" + _0x2740d1);
            const _0x549cb5 = await _0x17477b.json();
            if (Object.keys(_0x549cb5).length > 0 && _0x549cb5[_0x2740d1]) {
              _0x5c9f2e = _0x549cb5[_0x2740d1];
              break;
            }
          } catch (_0xbdd8c9) {}
        }
        if (!_0x5c9f2e) {
          const _0x35ba4c = {
            promptId: _0x2740d1,
            reason: "未在历史记录中找到该ID"
          };
          this.ctx.helpers.userError("ComfyUI 生成超时", _0x35ba4c);
          throw new Error("图片生成超时");
        }
        const _0x421fd4 = await this._extractComfyUIOutput(_0xbfe766, _0x167cd6, _0x5c9f2e);
        const _decUrl2 = await this._decryptComfyUIImage(_0x421fd4, "123qwe");
        const _0x2250ea = {
          success: true,
          imageUrl: _decUrl2,
          finalPositive: _0x2cd296,
          finalNegative: _0x4edc4f
        };
        return _0x2250ea;
      }
    } catch (_0x4686c5) {
      throw new Error("ComfyUI 生成失败: " + _0x4686c5.message);
    }
  }
  async _getComfyUIWorkflow(_0x134c25) {
    const _0x496e5d = await this.ctx.db.getAll(StoreNames.WORKFLOWS);
    const _0x3fe428 = _0x496e5d.find(_0x1f4c83 => _0x1f4c83.name === _0x134c25);
    if (_0x3fe428) {
      return JSON.parse(_0x3fe428.content);
    }
    return null;
  }
  async _processComfyUIWorkflow(_0x197c6a, _0x6ee655, _0x54afea, _0x1940fc = {}) {
    const _0x52f1d3 = JSON.parse(JSON.stringify(_0x197c6a));
    const _0x5b4dc0 = this.settings.comfyui;
    const _0x4ce55c = _0x1940fc.externalOptions || {};
    const _0xf8c8db = _0x4ce55c.skipPresets || false;
    const _0x4f6157 = !!_0x4ce55c.apiKey;
    const _0x17688c = _0x4ce55c.customParams || {};
    const _0x3409d6 = Number(_0x4ce55c.buttonEl?.dataset?.width) || Number(_0x17688c.width) || Number(_0x5b4dc0.width || this.settings.sd.width);
    const _0x446da5 = Number(_0x4ce55c.buttonEl?.dataset?.height) || Number(_0x17688c.height) || Number(_0x5b4dc0.height || this.settings.sd.height);
    const _0x87ab98 = {
      width: _0x3409d6,
      height: _0x446da5,
      steps: _0x5b4dc0.steps || this.settings.sd.steps,
      cfgScale: _0x5b4dc0.cfgScale || this.settings.sd.cfgScale,
      seed: _0x5b4dc0.seed !== undefined ? _0x5b4dc0.seed : this.settings.sd.seed
    };
    const _0x47bbd8 = _0x87ab98;
    const {
      i2iEnabled: _0x4b2878,
      i2iImage: _0x20b009,
      i2iMask: _0x29e63e
    } = _0x1940fc;
    this.ctx.log("image-gen", "ComfyUI 生成准备 (i2i=" + _0x4b2878 + ")");
    const _0x377316 = await this._getActiveLoraPreset();
    const _0x24530e = _0x377316?.loras || [];
    if (_0x377316) {
      this.ctx.log("image-gen", "使用LoRA预设: \"" + _0x377316.name + "\"");
    } else {
      this.ctx.log("image-gen", "未使用LoRA预设，占位符将重置为 None");
    }
    let _0x433e7f = _0x6ee655;
    let _0x2102c6 = _0x54afea;
    if (MultiCharacterParser.isMultiCharacterPrompt(_0x6ee655)) {
      this.ctx.log("image-gen", "检测到多角色语法，正在解析并提取...");
      const _0x35a3fd = MultiCharacterParser.parseScene(_0x6ee655);
      const _0x7f3bf = [];
      for (let _0x209c30 = 1; _0x209c30 <= 4; _0x209c30++) {
        const _0x1f8203 = _0x35a3fd["Character " + _0x209c30 + " UC"];
        if (_0x1f8203 && _0x1f8203.trim()) {
          _0x7f3bf.push(_0x1f8203.trim());
        }
      }
      if (_0x7f3bf.length > 0) {
        const _0x25779c = _0x7f3bf.join(", ");
        this.ctx.log("image-gen", "提取到角色负面内容: " + _0x25779c);
        _0x2102c6 = _0x2102c6 ? _0x2102c6 + ", " + _0x25779c : _0x25779c;
      }
      const _0x3e6cf6 = this.settings.comfyui.multiCharacterEnabled;
      if (_0x3e6cf6) {
        _0x433e7f = await this._convertToAttentionCouple(_0x6ee655);
      } else {
        this.ctx.log("image-gen", "ComfyUI 多角色未启用，执行智能平铺并去坐标");
        const _0x663aaf = [];
        if (_0x35a3fd["Scene Composition"]) {
          _0x663aaf.push(_0x35a3fd["Scene Composition"].trim());
        }
        for (let _0x229f84 = 1; _0x229f84 <= 4; _0x229f84++) {
          const _0x5365b7 = _0x35a3fd["Character " + _0x229f84 + " Prompt"];
          if (_0x5365b7 && _0x5365b7.trim()) {
            _0x663aaf.push(_0x5365b7.trim());
          }
        }
        _0x433e7f = _0x663aaf.join(", ").trim();
        if (!_0x433e7f) {
          this.ctx.log("image-gen", "智能平铺结果为空，回退到通用平铺模式处理非标准格式。");
          _0x433e7f = MultiCharacterParser.genericFlatten(_0x6ee655);
        }
      }
    }
    _0x433e7f = await this._buildPositivePrompt(_0x433e7f, _0xf8c8db);
    let _0x2370d1 = await this._buildNegativePrompt(_0x2102c6, _0xf8c8db);
    _0x433e7f = this._formatComfyPrompt(_0x433e7f);
    _0x2370d1 = this._formatComfyPrompt(_0x2370d1);
    const _0x472591 = _0x47bbd8.seed === -1 || _0x47bbd8.seed == null || _0x47bbd8.seed == 0 ? Math.floor(Math.random() * 1844674407370955300) : Number(_0x47bbd8.seed);
    const _0x390ba0 = new Map();
    const _0xc3bdaf = ["正面提示词", "正向提示词", "负面提示词", "负向提示词", "反面提示词", "反向提示词", "采样器", "调度器", "宽度", "高度", "步数", "种子", "CFG"];
    const _0x3dd54c = (_0x17477f, _0x3ad683) => {
      if (_0x4f6157 && _0xc3bdaf.includes(_0x17477f)) {
        return _0x17477f + ", " + _0x3ad683;
      }
      return _0x3ad683;
    };
    ["正面提示词", "正向提示词"].forEach(_0x3cd6ac => _0x390ba0.set(_0x3cd6ac, _0x3dd54c(_0x3cd6ac, _0x433e7f)));
    ["负面提示词", "负向提示词", "反面提示词", "反向提示词"].forEach(_0x26b4c5 => _0x390ba0.set(_0x26b4c5, _0x3dd54c(_0x26b4c5, _0x2370d1)));
    _0x390ba0.set("宽度", _0x3dd54c("宽度", Number(_0x47bbd8.width)));
    _0x390ba0.set("高度", _0x3dd54c("高度", Number(_0x47bbd8.height)));
    _0x390ba0.set("步数", _0x3dd54c("步数", Number(_0x47bbd8.steps)));
    _0x390ba0.set("CFG", _0x3dd54c("CFG", Number(_0x47bbd8.cfgScale)));
    _0x390ba0.set("种子", _0x3dd54c("种子", _0x472591));
    _0x390ba0.set("采样器", _0x3dd54c("采样器", _0x5b4dc0.sampler));
    _0x390ba0.set("调度器", _0x3dd54c("调度器", _0x5b4dc0.scheduler));
    _0x390ba0.set("主模型", _0x5b4dc0.model);
    _0x390ba0.set("修复模型", _0x5b4dc0.detailerModel);
    _0x390ba0.set("放大模型", _0x5b4dc0.upscaleModel);
    _0x390ba0.set("放大倍率", parseFloat(_0x5b4dc0.upscaleBy));
    _0x390ba0.set("修复步数", parseInt(_0x5b4dc0.ultimateSteps));
    _0x390ba0.set("Ultimate模型", _0x5b4dc0.ultimateModel);
    _0x390ba0.set("VAE解码", _0x5b4dc0.vaeModel);
    _0x390ba0.set("CLIP模型", _0x5b4dc0.clipModel);
    _0x390ba0.set("底图", _0x4b2878 ? this._extractBase64(_0x20b009) : null);
    _0x390ba0.set("重绘", _0x4b2878 ? this._extractBase64(_0x29e63e) : null);
    this.ctx.log("image-gen", "开始遍历工作流节点...");
    for (const _0x3ad973 in _0x52f1d3) {
      const _0xb7dd43 = _0x52f1d3[_0x3ad973];
      if (!_0xb7dd43 || !_0xb7dd43.inputs) {
        continue;
      }
      for (const _0x32bd23 of Object.keys(_0xb7dd43.inputs)) {
        const _0x42e89c = _0xb7dd43.inputs[_0x32bd23];
        if (typeof _0x42e89c !== "string") {
          continue;
        }
        if (_0x390ba0.has(_0x42e89c)) {
          const _0x1373c5 = _0x390ba0.get(_0x42e89c);
          if (_0x1373c5 !== null && _0x1373c5 !== undefined && _0x1373c5 !== "") {
            _0xb7dd43.inputs[_0x32bd23] = _0x1373c5;
            this.ctx.log("image-gen", "  -> 节点 #" + _0x3ad973 + "." + _0x32bd23 + ": 替换 \"" + _0x42e89c + "\" 为 \"" + String(_0x1373c5).substring(0, 50) + "...\"");
          }
          continue;
        }
        const _0x16ba19 = _0x42e89c.match(/^lora(\d+)$/);
        if (_0x16ba19) {
          const _0x9bdcfd = parseInt(_0x16ba19[1], 10) - 1;
          let _0x5a6a79 = "None";
          let _0xaabaf2 = 1;
          if (_0x24530e.length > _0x9bdcfd) {
            const _0x5e533f = _0x24530e[_0x9bdcfd];
            if (_0x5e533f && _0x5e533f.name && _0x5e533f.name !== "None") {
              _0x5a6a79 = _0x5e533f.name;
              if (!/\.(safetensors|bin|pt|ckpt)$/i.test(_0x5a6a79)) {
                _0x5a6a79 += ".safetensors";
              }
              _0xaabaf2 = parseFloat(_0x5e533f.strength) || 1;
            }
          }
          if (_0x4f6157 && _0x5a6a79 !== "None") {
            _0xb7dd43.inputs[_0x32bd23] = _0x42e89c + ", " + _0x5a6a79;
          } else {
            _0xb7dd43.inputs[_0x32bd23] = _0x5a6a79;
          }
          if (_0x5a6a79 !== "None") {
            this.ctx.log("image-gen", "  -> 节点 #" + _0x3ad973 + "." + _0x32bd23 + ": 注入LoRA " + (_0x9bdcfd + 1) + " \"" + _0x5a6a79 + "\" (权重: " + _0xaabaf2 + ")");
            const _0x83a33b = "strength_0" + (_0x9bdcfd % 4 + 1);
            if (_0xb7dd43.inputs.hasOwnProperty(_0x83a33b)) {
              _0xb7dd43.inputs[_0x83a33b] = _0xaabaf2;
            }
            if (_0xb7dd43.inputs.hasOwnProperty("strength_model")) {
              _0xb7dd43.inputs.strength_model = _0xaabaf2;
            }
            if (_0xb7dd43.inputs.hasOwnProperty("strength_clip")) {
              _0xb7dd43.inputs.strength_clip = _0xaabaf2;
            }
          } else {}
        }
      }
    }
    const _0x137f58 = new Date();
    const _0x2c55af = _0x137f58.getFullYear() + "-" + String(_0x137f58.getMonth() + 1).padStart(2, "0") + "-" + String(_0x137f58.getDate()).padStart(2, "0");
    for (const _0x2f0dcc in _0x52f1d3) {
      const _0x383cd0 = _0x52f1d3[_0x2f0dcc];
      if (_0x383cd0?.class_type === "SaveImage" && _0x383cd0.inputs?.filename_prefix === "日期") {
        _0x383cd0.inputs.filename_prefix = _0x2c55af + "/ComfyUI";
        this.ctx.log("image-gen", "SaveImage 节点文件名日期已替换");
        break;
      }
    }
    const _0x1d14c3 = {
      workflow: _0x52f1d3,
      positive: _0x433e7f,
      negative: _0x2370d1
    };
    return _0x1d14c3;
  }
  async _getActiveLoraPreset() {
    try {
      const _0x188195 = await this.ctx.db.getAll(StoreNames.LORA_PRESETS);
      return _0x188195.find(_0x1746f3 => _0x1746f3.status === 1);
    } catch (_0x4a962e) {
      return null;
    }
  }
  async _extractComfyUIOutput(_0x454080, _0x22a391, _0x4fa089) {
    const _0xa83685 = ["SaveImage", "PreviewImage", "SaveVideo", "VHS_VideoCombine", "VHS_VideoSave", "SaveAnimatedWEBP", "AnimateDiffCombine"];
    const _0x30e739 = Object.keys(_0x22a391).filter(_0x141a7d => _0xa83685.includes(_0x22a391[_0x141a7d]?.class_type));
    for (const _0x2d49e3 of _0x30e739) {
      const _0x1fcd32 = _0x4fa089.outputs?.[_0x2d49e3];
      if (!_0x1fcd32) {
        continue;
      }
      const _0x3712e6 = [_0x1fcd32.videos, _0x1fcd32.gifs, _0x1fcd32.images];
      for (const _0x29b2b1 of _0x3712e6) {
        if (_0x29b2b1 && _0x29b2b1.length > 0) {
          const _0x445f30 = _0x29b2b1[0];
          let _0x4ef6b1 = _0x454080 + "/view?filename=" + encodeURIComponent(_0x445f30.filename);
          if (_0x445f30.type) {
            _0x4ef6b1 += "&type=" + _0x445f30.type;
          }
          if (_0x445f30.subfolder) {
            _0x4ef6b1 += "&subfolder=" + encodeURIComponent(_0x445f30.subfolder);
          }
          this.ctx.log("image-gen", "ComfyUI 图片 URL:", _0x4ef6b1);
          const _0x6e53fe = await fetch(_0x4ef6b1);
          if (!_0x6e53fe.ok) {
            throw new Error("获取图片失败: " + _0x6e53fe.status);
          }
          const _0x59b362 = await _0x6e53fe.blob();
          return await this._blobToDataURL(_0x59b362);
        }
      }
    }
    this.ctx.helpers.userError("ComfyUI 结果解析失败", {
      historyOutputs: _0x4fa089.outputs,
      workflow: Object.keys(_0x22a391)
    });
    throw new Error("未找到输出图像");
  }
  async generateWithOther(_0x3feef5, _0x38346e, _0x4ee00b = {}) {
    const _0x2ac06f = this.settings.other;
    const {
      i2iEnabled: _0x17ac5b,
      i2iImage: _0x3f26fd,
      i2iMask: _0x319296,
      customParams: _0x691ab8,
      skipPresets: _0x4c955d
    } = _0x4ee00b;
    this.ctx.log("image-gen", "Other API 生成: customParams=", _0x691ab8);
    if (!_0x2ac06f.url) {
      throw new Error("请先配置 API URL");
    }
    let _0x22a9e7 = this._removeTrailingSlash(_0x2ac06f.url);
    if (_0x22a9e7.endsWith("/v1")) {
      _0x22a9e7 += "/chat/completions";
      this.ctx.log("image-gen", "[Other API] URL 自动补全为: " + _0x22a9e7);
    }
    this.ctx.log("image-gen", "Other API 生成请求地址: " + _0x22a9e7);
    const _0x1080c7 = this.ctx.getModule("triggerProcessor");
    if (_0x1080c7) {
      _0x3feef5 = await _0x1080c7.processTriggers(_0x3feef5);
      if (_0x38346e) {
        _0x38346e = await _0x1080c7.processTriggers(_0x38346e);
      }
    }
    const _0x3bd9ba = await this._buildPositivePrompt(_0x3feef5, _0x4c955d);
    const _0x247e58 = await this._buildNegativePrompt(_0x38346e, _0x4c955d);
    const _0x9b155a = _0x17ac5b && _0x3f26fd;
    const _0x4bac82 = _0x691ab8?.width || _0x2ac06f.width;
    const _0x20041b = _0x691ab8?.height || _0x2ac06f.height;
    const _0x46b5b9 = _0x691ab8?.seed !== undefined ? _0x691ab8.seed : _0x2ac06f.seed !== undefined ? _0x2ac06f.seed : -1;
    const _0x503536 = {
      name: "正面提示词",
      value: _0x3bd9ba
    };
    const _0x17fbb4 = {
      name: "负面提示词",
      value: _0x247e58
    };
    const _0xab24ee = [_0x503536, _0x17fbb4, {
      name: "宽度",
      value: String(_0x4bac82)
    }, {
      name: "高度",
      value: String(_0x20041b)
    }, {
      name: "步数",
      value: String(_0x691ab8?.steps || _0x2ac06f.steps || 20)
    }, {
      name: "CFG",
      value: String(_0x691ab8?.cfgScale || _0x2ac06f.cfgScale || 7)
    }, {
      name: "种子",
      value: String(_0x46b5b9)
    }, {
      name: "尺寸",
      value: _0x4bac82 + "x" + _0x20041b
    }, {
      name: "宽度x高度",
      value: _0x4bac82 + "x" + _0x20041b
    }, {
      name: "宽度:高度",
      value: _0x4bac82 + ":" + _0x20041b
    }, {
      name: "图片",
      value: _0x9b155a ? this._extractBase64Data(_0x3f26fd) : ""
    }, {
      name: "图片完整",
      value: _0x9b155a ? _0x3f26fd : ""
    }, {
      name: "蒙版",
      value: _0x9b155a && _0x319296 ? this._extractBase64Data(_0x319296) : ""
    }, {
      name: "蒙版完整",
      value: _0x9b155a && _0x319296 ? _0x319296 : ""
    }];
    const _0xfbf11e = [..._0xab24ee, ...(_0x2ac06f.placeholders || [])];
    let _0xb90184;
    if (_0x2ac06f.customBody) {
      try {
        const _0x5e8973 = typeof _0x2ac06f.customBody === "string" ? JSON.parse(_0x2ac06f.customBody) : _0x2ac06f.customBody;
        _0xb90184 = _0x5e8973;
        this.ctx.log("image-gen", "使用自定义请求体格式");
      } catch (_0x3a580e) {
        this.ctx.warn("image-gen", "自定义请求体解析失败，使用默认格式:", _0x3a580e);
        _0xb90184 = this._buildDefaultPayload(_0x2ac06f, _0x3bd9ba, _0x9b155a, _0x3f26fd);
      }
    } else {
      _0xb90184 = this._buildDefaultPayload(_0x2ac06f, _0x3bd9ba, _0x9b155a, _0x3f26fd);
    }
    const _0x2114c4 = this._processPlaceholders(_0xb90184, _0xfbf11e);
    let _0x395ee4 = _0x2114c4;
    if (_0x2ac06f.pureMode && _0x2ac06f.customBody) {
      this.ctx.log("image-gen", "启用纯净模式，直接使用自定义请求体");
    } else {
      const _0x34492f = _0x691ab8?.model || _0x2ac06f.model;
      if (_0x34492f) {
        _0x2114c4.model = _0x34492f;
        this.ctx.log("image-gen", "自动补充model字段:", _0x34492f);
      }
      _0x395ee4 = _0x2114c4;
    }
    const _0x10bb28 = {
      "Content-Type": "application/json"
    };
    if (_0x2ac06f.apiKey) {
      _0x10bb28.Authorization = "Bearer " + _0x2ac06f.apiKey;
    }
    if (_0x2ac06f.customHeaders) {
      try {
        const _0x2efdb9 = typeof _0x2ac06f.customHeaders === "string" ? JSON.parse(_0x2ac06f.customHeaders) : _0x2ac06f.customHeaders;
        Object.assign(_0x10bb28, _0x2efdb9);
      } catch (_0x2efa3f) {
        this.ctx.warn("image-gen", "自定义请求头解析失败，忽略:", _0x2efa3f);
      }
    }
    let _0x19120d = null;
    try {
      const _0x35abd7 = await fetch(_0x22a9e7, {
        method: "POST",
        headers: _0x10bb28,
        body: JSON.stringify(_0x395ee4)
      });
      if (!_0x35abd7.ok) {
        const _0x529f59 = await _0x35abd7.text();
        throw new Error("API 错误 (" + _0x35abd7.status + "): " + _0x529f59);
      }
      const _0x13c0e5 = await _0x35abd7.text();
      console.log("[Other API] 原始返回数据:", _0x13c0e5.substring(0, 1000) + (_0x13c0e5.length > 1000 ? "..." : ""));
      let _0x2574e4 = "";
      let _0x7768c7 = null;
      try {
        if (_0x13c0e5.trim().startsWith("{")) {
          _0x7768c7 = JSON.parse(_0x13c0e5);
          if (_0x7768c7.error) {
            throw new Error(JSON.stringify(_0x7768c7.error));
          }
          _0x2574e4 = _0x7768c7.choices?.[0]?.message?.content;
          if (!_0x2574e4 && _0x7768c7.data && Array.isArray(_0x7768c7.data)) {
            const _0x8bc5b0 = _0x7768c7.data[0];
            if (_0x8bc5b0.b64_json) {
              _0x2574e4 = "data:image/png;base64," + _0x8bc5b0.b64_json;
            } else if (_0x8bc5b0.url) {
              _0x2574e4 = _0x8bc5b0.url;
            }
          }
          if (!_0x2574e4) {
            _0x2574e4 = _0x7768c7.content || _0x7768c7.url || _0x7768c7.output;
          }
          if (!_0x2574e4 && _0x7768c7.content?.video_url) {
            const _0x51259e = _0x7768c7.content.video_url.trim();
            this.ctx.log("image-gen", "[Other API] 检测到视频下载链接，开始下载:", _0x51259e);
            try {
              const _0x37f542 = await fetch(_0x51259e);
              if (!_0x37f542.ok) {
                throw new Error("视频下载失败: " + _0x37f542.status);
              }
              const _0x1fcb86 = await _0x37f542.blob();
              const _0x1805ff = await this._blobToDataURL(_0x1fcb86);
              _0x2574e4 = _0x1805ff;
              this.ctx.log("image-gen", "[Other API] 视频下载完成并转换为 data URL");
            } catch (_0x47163c) {
              this.ctx.error("image-gen", "[Other API] 视频下载失败:", _0x47163c.message);
              throw new Error("视频下载失败: " + _0x47163c.message);
            }
          }
          if (!_0x2574e4 && _0x7768c7.id) {
            this.ctx.log("image-gen", "[Other API] 检测到任务ID响应，开始轮询获取结果...");
            const _0x4bfa63 = _0x22a9e7.replace(/\/generate$/, "/tasks/" + _0x7768c7.id);
            try {
              for (let _0x303b28 = 0; _0x303b28 < 60; _0x303b28++) {
                await this._sleep(5000);
                const _0x184c18 = await fetch(_0x4bfa63, {
                  method: "GET",
                  headers: _0x10bb28
                });
                if (!_0x184c18.ok) {
                  throw new Error("轮询失败: " + _0x184c18.status);
                }
                const _0x4b32c7 = await _0x184c18.text();
                console.log("[Other API] 轮询响应:", _0x4b32c7.substring(0, 1000));
                const _0x426be9 = JSON.parse(_0x4b32c7);
                let _0x4962d6 = null;
                if (_0x426be9.items && Array.isArray(_0x426be9.items)) {
                  _0x4962d6 = _0x426be9.items.find(_0x2dc3ad => _0x2dc3ad.id === _0x7768c7.id);
                }
                const _0x24fa72 = _0x4962d6?.status || _0x426be9.status;
                if (_0x24fa72 === "completed" || _0x24fa72 === "succeeded") {
                  const _0x2f0d5c = _0x4962d6?.content || _0x426be9.content;
                  if (_0x2f0d5c?.video_url) {
                    const _0x500704 = _0x2f0d5c.video_url.trim().replace(/[`\s]+/g, "");
                    this.ctx.log("image-gen", "[Other API] 检测到视频下载链接，开始下载:", _0x500704);
                    try {
                      let _0x25931c;
                      try {
                        _0x25931c = await fetch(_0x500704);
                        if (!_0x25931c.ok) {
                          throw new Error("视频下载失败: " + _0x25931c.status);
                        }
                      } catch (_0xe2b268) {
                        this.ctx.log("image-gen", "[Other API] 直接下载失败，尝试使用CORS代理:", _0xe2b268.message);
                        const _0x7c7b7 = "https://cors.eu.org/";
                        const _0x4506ab = _0x7c7b7 + _0x500704;
                        _0x25931c = await fetch(_0x4506ab);
                        if (!_0x25931c.ok) {
                          throw new Error("代理下载失败: " + _0x25931c.status);
                        }
                      }
                      const _0x5d43b = await _0x25931c.blob();
                      const _0x5e6b5d = await this._blobToDataURL(_0x5d43b);
                      _0x2574e4 = _0x5e6b5d;
                      this.ctx.log("image-gen", "[Other API] 视频下载完成并转换为 data URL");
                    } catch (_0x9545b6) {
                      this.ctx.error("image-gen", "[Other API] 视频下载失败:", _0x9545b6.message);
                      throw new Error("视频下载失败: " + _0x9545b6.message);
                    }
                  } else if (_0x2f0d5c?.image_url) {
                    const _0xb53133 = _0x2f0d5c.image_url.trim().replace(/[`\s]+/g, "");
                    this.ctx.log("image-gen", "[Other API] 检测到图片下载链接，开始下载:", _0xb53133);
                    try {
                      let _0x3466cf;
                      try {
                        _0x3466cf = await fetch(_0xb53133);
                        if (!_0x3466cf.ok) {
                          throw new Error("图片下载失败: " + _0x3466cf.status);
                        }
                      } catch (_0x17b07d) {
                        this.ctx.log("image-gen", "[Other API] 直接下载失败，尝试使用CORS代理:", _0x17b07d.message);
                        const _0x54e53a = "https://cors.eu.org/";
                        const _0x24b034 = _0x54e53a + _0xb53133;
                        _0x3466cf = await fetch(_0x24b034);
                        if (!_0x3466cf.ok) {
                          throw new Error("代理下载失败: " + _0x3466cf.status);
                        }
                      }
                      const _0x466c40 = await _0x3466cf.blob();
                      const _0x1b7cfa = await this._blobToDataURL(_0x466c40);
                      _0x2574e4 = _0x1b7cfa;
                      this.ctx.log("image-gen", "[Other API] 图片下载完成并转换为 data URL");
                    } catch (_0x567c65) {
                      this.ctx.error("image-gen", "[Other API] 图片下载失败:", _0x567c65.message);
                      throw new Error("图片下载失败: " + _0x567c65.message);
                    }
                  } else if (_0x426be9.result?.video) {
                    _0x2574e4 = _0x426be9.result.video;
                  } else if (_0x426be9.result?.image) {
                    _0x2574e4 = _0x426be9.result.image;
                  } else if (_0x426be9.output) {
                    _0x2574e4 = _0x426be9.output;
                  } else if (_0x426be9.data) {
                    _0x2574e4 = _0x426be9.data;
                  }
                  break;
                } else if (_0x24fa72 === "failed" || _0x24fa72 === "error") {
                  const _0x709799 = _0x4962d6?.error?.message || _0x426be9.error?.message || _0x426be9.message || "未知错误";
                  const _0x1b24ae = _0x4962d6?.error?.code || _0x426be9.error?.code || "";
                  throw new Error("任务失败 (" + _0x1b24ae + "): " + _0x709799);
                }
              }
            } catch (_0x569f47) {
              this.ctx.warn("image-gen", "[Other API] 轮询失败，尝试直接使用原始响应:", _0x569f47.message);
            }
          }
          if (!_0x2574e4) {
            _0x2574e4 = _0x13c0e5;
          }
        }
      } catch (_0x237da9) {
        this.ctx.warn("image-gen", "[Other API] JSON 解析失败:", _0x237da9.message);
      }
      if (!_0x2574e4 && (_0x13c0e5.trim().startsWith("data:") || _0x13c0e5.includes("\ndata:"))) {
        this.ctx.log("image-gen", "[Other API] 检测到流式响应，正在拼接...");
        const _0x1e14a8 = _0x13c0e5.split("\n");
        let _0x2be5cf = "";
        let _0x380d7e = false;
        for (const _0xe00c6e of _0x1e14a8) {
          const _0xf10da1 = _0xe00c6e.trim();
          if (!_0xf10da1.startsWith("data: ")) {
            continue;
          }
          const _0x103b0f = _0xf10da1.slice(6);
          if (_0x103b0f === "[DONE]") {
            continue;
          }
          try {
            const _0x4ec5f2 = JSON.parse(_0x103b0f);
            const _0x47517a = _0x4ec5f2.choices?.[0]?.delta?.content;
            if (_0x47517a) {
              _0x2be5cf += _0x47517a;
              _0x380d7e = true;
            }
          } catch (_0x396d2d) {}
        }
        if (_0x380d7e) {
          _0x2574e4 = _0x2be5cf;
        }
      }
      if (!_0x2574e4) {
        _0x2574e4 = _0x13c0e5;
      }
      if (!_0x2574e4) {
        throw new Error("未能解析到有效内容 (content/data/url)。");
      }
      let _0x327d6a = null;
      const _0x2d4ec3 = _0x2574e4.match(/data:(image|video)\/\w+;base64,([A-Za-z0-9+/=]+)/);
      if (_0x2d4ec3) {
        _0x19120d = _0x2d4ec3[0];
      } else {
        const _0x4516a3 = /!?\[.*?\]\((.*?)\)/;
        const _0x3b172c = _0x2574e4.match(_0x4516a3);
        if (_0x3b172c) {
          _0x327d6a = _0x3b172c[1];
        } else if (_0x2574e4.trim().startsWith("http")) {
          _0x327d6a = _0x2574e4.trim();
        } else if (_0x7768c7 && (_0x7768c7.url || _0x7768c7.output)) {
          _0x327d6a = _0x7768c7.url || _0x7768c7.output;
        }
      }
      if (_0x327d6a && !_0x19120d) {
        if (_0x327d6a.startsWith("data:")) {
          _0x19120d = _0x327d6a;
        } else if (_0x327d6a.startsWith("http")) {
          this.ctx.log("image-gen", "[Other API] 检测到远程链接，开始下载: " + _0x327d6a);
          if (_0x4ee00b.buttonEl) {
            this._updateButtonStatus(_0x4ee00b.buttonEl, "loading", "下载媒体...");
          }
          let _0x1f1f96 = null;
          try {
            this.ctx.log("image-gen", "[Other API] 尝试直连原始URL: " + _0x327d6a);
            const _0x161c95 = await fetch(_0x327d6a, {
              mode: "cors"
            });
            if (_0x161c95.ok) {
              const _0xcdb8ba = await _0x161c95.blob();
              _0x19120d = await this._blobToDataURL(_0xcdb8ba);
            } else {
              _0x1f1f96 = new Error("直连下载失败 HTTP " + _0x161c95.status);
            }
          } catch (_0x16eb3f) {
            _0x1f1f96 = _0x16eb3f;
            this.ctx.warn("image-gen", "[Other API] 原始URL直连失败 (" + _0x16eb3f.message + ")");
          }
          if (!_0x19120d && _0x327d6a.startsWith("http://")) {
            const _0x1711d8 = _0x327d6a.replace("http://", "https://");
            try {
              this.ctx.log("image-gen", "[Other API] 尝试HTTPS: " + _0x1711d8);
              const _0x59e77c = await fetch(_0x1711d8, {
                mode: "cors"
              });
              if (_0x59e77c.ok) {
                const _0x5f0ee9 = await _0x59e77c.blob();
                _0x19120d = await this._blobToDataURL(_0x5f0ee9);
              }
            } catch (_0x47e380) {
              this.ctx.warn("image-gen", "[Other API] HTTPS尝试也失败 (" + _0x47e380.message + ")");
            }
          }
          if (!_0x19120d) {
            try {
              this.ctx.log("image-gen", "[Other API] 尝试 no-cors 模式: " + _0x327d6a);
              const _0x4f861d = await fetch(_0x327d6a, {
                mode: "no-cors"
              });
              const _0x284c82 = await _0x4f861d.blob();
              if (_0x284c82 && _0x284c82.size > 0) {
                _0x19120d = await this._blobToDataURL(_0x284c82);
              }
            } catch (_0x20d7a7) {
              this.ctx.warn("image-gen", "[Other API] no-cors 模式失败 (" + _0x20d7a7.message + ")");
            }
          }
          if (!_0x19120d) {
            this.ctx.warn("image-gen", "[Other API] 直连全部失败，尝试使用插件代理...");
            try {
              const _0x1f0c1e = getRequestHeaders();
              _0x1f0c1e["Content-Type"] = "application/json";
              const _0xaa589d = await fetch("/api/proxy", {
                method: "POST",
                headers: _0x1f0c1e,
                body: JSON.stringify({
                  url: _0x327d6a,
                  method: "GET",
                  headers: {}
                })
              });
              if (!_0xaa589d.ok) {
                throw new Error("Proxy request failed");
              }
              const _0x1a1a53 = await _0xaa589d.blob();
              if (_0x1a1a53.type.includes("application/json")) {
                throw new Error("Proxy returned JSON (likely error)");
              }
              _0x19120d = await this._blobToDataURL(_0x1a1a53);
            } catch (_0x24f058) {
              throw new Error("无法下载链接: " + _0x327d6a + "。直连和代理均失败，请检查链接有效性或服务器配置。");
            }
          }
        }
      }
      if (!_0x19120d) {
        console.warn("[Other API] 解析失败的内容片段:", _0x2574e4.substring(0, 500));
        throw new Error("响应中未包含有效的 Base64 数据或 URL 图片链接。");
      }
      const _0x46e149 = {
        success: true,
        imageUrl: _0x19120d,
        finalPositive: _0x3bd9ba,
        finalNegative: _0x247e58
      };
      return _0x46e149;
    } catch (_0x5e1148) {
      console.error(_0x5e1148);
      this.ctx.error("image-gen", "[Other API] 处理失败:", _0x5e1148.message);
      if (_0x19120d) {
        const _0x233f1f = {
          success: true,
          imageUrl: _0x19120d,
          finalPositive: _0x3bd9ba,
          finalNegative: _0x247e58
        };
        return _0x233f1f;
      }
      const _0x546ebe = {
        success: false,
        error: _0x5e1148.message
      };
      return _0x546ebe;
    }
  }
  async _buildPositivePrompt(_0xea764f, _0x4c0558 = false) {
    const _0x39dbf9 = await this.ctx.db.getAll(StoreNames.PRESETS);
    const _0x40d941 = _0x39dbf9.find(_0x2a0f73 => _0x2a0f73.name === this.settings.activePresetName);
    const _0x7a2254 = _0x39dbf9.find(_0x1c1282 => _0x1c1282.name === this.settings.activePresetAfter);
    const _0xe93879 = [];
    if (!_0x4c0558 && _0x40d941?.positivePrompt) {
      _0xe93879.push(_0x40d941.positivePrompt);
    }
    _0xe93879.push(_0xea764f);
    if (!_0x4c0558 && _0x7a2254?.positivePrompt) {
      _0xe93879.push(_0x7a2254.positivePrompt);
    }
    let _0x2a8981 = this._cleanPromptText(_0xe93879.join(", "));
    const _0x5717e5 = this.ctx.getModule("triggerProcessor");
    if (_0x5717e5) {
      try {
        _0x2a8981 = await _0x5717e5.processTriggers(_0x2a8981, true);
      } catch (_0x205a36) {
        this.ctx.error("image-gen", "触发词处理失败:", _0x205a36);
      }
    }
    return _0x2a8981;
  }
  async _buildNegativePrompt(_0x53b46c, _0x77862d = false) {
    const _0x50b545 = await this.ctx.db.getAll(StoreNames.PRESETS);
    const _0x47427d = _0x50b545.find(_0x29c18c => _0x29c18c.name === this.settings.activePresetName);
    const _0x5b689c = _0x50b545.find(_0x5325aa => _0x5325aa.name === this.settings.activePresetAfter);
    const _0x5da36f = [];
    if (!_0x77862d && _0x47427d?.negativePrompt) {
      _0x5da36f.push(_0x47427d.negativePrompt);
    }
    if (_0x53b46c) {
      _0x5da36f.push(_0x53b46c);
    }
    if (!_0x77862d && _0x5b689c?.negativePrompt) {
      const _0x219c09 = _0x5b689c.negativePrompt.trim();
      if (!_0x53b46c || !_0x53b46c.includes(_0x219c09)) {
        _0x5da36f.push(_0x219c09);
      }
    }
    return this._cleanPromptText(_0x5da36f.join(", "));
  }
  async _convertToAttentionCouple(_0xd23e28) {
    const _0x248fee = MultiCharacterParser.parseScene(_0xd23e28);
    const _0x55a563 = await this._buildPositivePrompt(_0x248fee["Scene Composition"].trim());
    const _0x37f908 = [_0x55a563];
    const _0x37a87e = [1, 0.6, 0.5, 0.5];
    const _0x9717b9 = 8;
    for (let _0x1e6ff5 = 1; _0x1e6ff5 <= 4; _0x1e6ff5++) {
      const _0x44d7e2 = "Character " + _0x1e6ff5 + " Prompt";
      const _0x2d8338 = "Character " + _0x1e6ff5 + " centers";
      if (_0x248fee[_0x44d7e2]) {
        const _0x4a2944 = _0x248fee[_0x44d7e2].trim();
        const _0x5ac1fe = _0x248fee[_0x2d8338];
        const _0x118149 = _0x37a87e[_0x1e6ff5 - 1];
        if (_0x5ac1fe) {
          const _0x3b0871 = MultiCharacterParser.gridRefToBoundingBox(_0x5ac1fe);
          const _0x5b5153 = "COUPLE MASK(" + _0x3b0871.x1 + " " + _0x3b0871.x2 + ", " + _0x3b0871.y1 + " " + _0x3b0871.y2 + ", " + _0x118149.toFixed(2) + ")";
          const _0x47dd28 = "FEATHER(" + _0x9717b9 + ")";
          _0x37f908.push(_0x5b5153, _0x4a2944, _0x47dd28);
          this.ctx.log("image-gen", "[Multi-Character] 转换角色 " + _0x1e6ff5 + " (" + _0x5ac1fe + "): MASK(" + _0x3b0871.x1 + " " + _0x3b0871.x2 + ", " + _0x3b0871.y1 + " " + _0x3b0871.y2 + ", " + _0x118149.toFixed(2) + ")");
        } else {
          _0x37f908.push(_0x4a2944);
        }
      }
    }
    const _0x29859c = _0x37f908.join("\n");
    this.ctx.log("image-gen", "[Multi-Character] Attention Couple 转换完成");
    return _0x29859c;
  }
  async _getNextImageId() {
    if (this._nextImageId !== null) {
      return ++this._nextImageId;
    }
    return new Promise((_0x63440, _0x37b5bb) => {
      if (!this.ctx.db.db) {
        this._nextImageId = Date.now();
        _0x63440(this._nextImageId);
        return;
      }
      const _0x3f14a4 = this.ctx.db.db.transaction([StoreNames.IMAGE_CACHE], "readonly");
      const _0x63bada = _0x3f14a4.objectStore(StoreNames.IMAGE_CACHE);
      const _0x2c7bcc = _0x63bada.openKeyCursor(null, "prev");
      _0x2c7bcc.onsuccess = _0xa237f2 => {
        const _0x57634c = _0xa237f2.target.result;
        if (_0x57634c) {
          this._nextImageId = Number(_0x57634c.key) + 1;
        } else {
          this._nextImageId = 1;
        }
        _0x63440(this._nextImageId);
      };
      _0x2c7bcc.onerror = () => {
        this._nextImageId = Date.now();
        _0x63440(this._nextImageId);
      };
    });
  }
  async cacheImage(_0x595095, _0x48b5db, _0x4fd3d6, _0x3e5314, _0x81e37c = null) {
    if (_0x595095 === undefined || _0x595095 === null || isNaN(_0x595095)) {
      this.ctx.error("image-gen", "无效的图像 ID:", _0x595095);
      _0x595095 = Date.now();
    }
    const _0x25a68f = _0x81e37c || this.settings.currentMode;
    const _0x1e16fb = this._getCurrentFormattedTime();
    const _0x6dd739 = {
      time: _0x1e16fb,
      mode: _0x25a68f
    };
    const _0x3018fd = _0x6dd739;
    try {
      if (this.storageManager) {
        const _0x5d966e = this.storageManager.getStorageMode();
        this.ctx.log("image-gen", "准备缓存图像: id=" + _0x595095 + ", 存储模式=" + _0x5d966e);
        const _0x37614e = await this.storageManager.saveImage(_0x595095, _0x48b5db, _0x4fd3d6, _0x3e5314, _0x3018fd);
        this.ctx.log("image-gen", "图像已缓存: id=" + _0x595095 + ", hash=" + (_0x4fd3d6 ? _0x4fd3d6.substring(0, 12) + "..." : "(无)") + ", mode=" + _0x25a68f + ", serverPath=" + (_0x37614e.serverPath || "(无)"));
      } else {
        this.ctx.warn("image-gen", "storageManager 未初始化，回退到 IndexedDB");
        const _0x49e52b = {
          id: Number(_0x595095),
          imageData: _0x48b5db,
          locationHash: _0x4fd3d6 || "",
          originalPrompt: _0x3e5314 || "",
          editedPrompt: null,
          timestamp: Date.now(),
          serverPath: null,
          time: _0x1e16fb,
          mode: _0x25a68f
        };
        await this.ctx.db.put(StoreNames.IMAGE_CACHE, _0x49e52b);
      }
      if (_0x4fd3d6 && _0x4fd3d6.length > 0) {
        this._locationToImageIdMap[_0x4fd3d6] = Number(_0x595095);
      }
    } catch (_0x592d35) {
      this.ctx.error("image-gen", "缓存图像失败:", _0x592d35);
      try {
        const _0x86a786 = {
          id: Number(_0x595095),
          imageData: _0x48b5db,
          locationHash: _0x4fd3d6 || "",
          originalPrompt: _0x3e5314 || "",
          editedPrompt: null,
          timestamp: Date.now(),
          serverPath: null,
          time: _0x1e16fb,
          mode: _0x25a68f
        };
        await this.ctx.db.put(StoreNames.IMAGE_CACHE, _0x86a786);
      } catch (_0x36d7f6) {
        console.error("Critical cache failure", _0x36d7f6);
      }
    }
  }
  async _refreshMessageButtons(_0x4c1d6f, _0x230630) {
    const _0x7a0bbb = document.getElementById("chat");
    if (!_0x7a0bbb) {
      return;
    }
    this._locationToImageIdMap[_0x4c1d6f] = Number(_0x230630);
    let _0x1f5078 = "";
    try {
      const _0x37d440 = await this.getCachedImage(_0x230630);
      if (_0x37d440) {
        if (_0x37d440.imageData) {
          _0x1f5078 = _0x37d440.imageData;
        } else if (_0x37d440.serverPath) {
          _0x1f5078 = _0x37d440.serverPath;
        }
      }
    } catch (_0x577a29) {}
    _0x7a0bbb.querySelectorAll(".mes").forEach(_0x199723 => {
      const _0x4e0af9 = _0x199723;
      const _0x27b690 = _0x4e0af9.querySelectorAll(".tsp-inline-gen-btn[data-location-hash=\"" + _0x4c1d6f + "\"]");
      _0x27b690.forEach(_0x27df96 => {
        if (_0x27df96.parentElement && _0x27df96.parentElement.classList.contains("tsp-image-slot")) {} else {
          this._displayImageAtButton(_0x27df96, _0x1f5078, _0x230630, _0x4c1d6f);
        }
      });
      const _0x491cb4 = _0x4e0af9.querySelectorAll(".tsp-image-slot[data-location-hash=\"" + _0x4c1d6f + "\"]");
      _0x491cb4.forEach(_0x4cb9d7 => {
        if (_0x4cb9d7 instanceof HTMLElement) {
          _0x4cb9d7.dataset.imageId = String(_0x230630);
          const _0x47a1de = _0x4cb9d7.querySelector(".tsp-inline-image");
          if (_0x47a1de) {
            _0x47a1de.remove();
          }
          const _0xf65872 = _0x4cb9d7.ownerDocument || document;
          const _0x35e101 = _0xf65872.createElement("img");
          _0x35e101.className = "tsp-generated-image tsp-inline-image";
          _0x35e101.dataset.imageId = String(_0x230630);
          _0x35e101.dataset.locationHash = _0x4c1d6f;
          const _0x2d137c = this._zoomRatio || 100;
          _0x35e101.style.cssText = "max-width: " + _0x2d137c + "%; cursor: pointer; border-radius: 8px; margin: 0; min-height: 50px; background: rgba(122,162,247,0.1);";
          if (_0x1f5078) {
            if (_0x1f5078 instanceof Blob) {
              _0x35e101.src = URL.createObjectURL(_0x1f5078);
            } else if (typeof _0x1f5078 === "string" && _0x1f5078.startsWith("data:image")) {
              const _0x31a59f = this._dataURLtoBlob(_0x1f5078);
              _0x35e101.src = _0x31a59f ? URL.createObjectURL(_0x31a59f) : _0x1f5078;
            } else {
              _0x35e101.src = _0x1f5078;
            }
            _0x35e101.dataset.isLoaded = "true";
            this._observeImage(_0x35e101, true);
          } else {
            _0x35e101.src = TRANSPARENT_PIXEL;
            _0x35e101.dataset.isLoaded = "false";
            this._observeImage(_0x35e101, false);
          }
          if (this.interactionManager && _0xf65872 === document) {
            this.interactionManager.addSmartClickHandler(_0x35e101);
          }
          _0x4cb9d7.appendChild(_0x35e101);
        }
      });
    });
    _0x7a0bbb.querySelectorAll("iframe").forEach(_0xdda723 => {
      try {
        const _0x1ac403 = _0xdda723.contentDocument || _0xdda723.contentWindow?.document;
        if (!_0x1ac403) {
          return;
        }
        const _0x255347 = _0x1ac403.querySelectorAll(".tsp-inline-gen-btn[data-location-hash=\"" + _0x4c1d6f + "\"]");
        _0x255347.forEach(_0x1e9725 => {
          if (_0x1e9725.parentElement && _0x1e9725.parentElement.classList.contains("tsp-image-slot")) {} else {
            this._displayImageAtButton(_0x1e9725, _0x1f5078, _0x230630, _0x4c1d6f);
          }
        });
        const _0x1b409b = _0x1ac403.querySelectorAll(".tsp-image-slot[data-location-hash=\"" + _0x4c1d6f + "\"]");
        _0x1b409b.forEach(_0x34196d => {
          if (_0x34196d instanceof HTMLElement) {
            _0x34196d.dataset.imageId = String(_0x230630);
            const _0x5c827f = _0x34196d.querySelector(".tsp-inline-image");
            if (_0x5c827f) {
              _0x5c827f.remove();
            }
            const _0x28c56f = _0x34196d.ownerDocument || document;
            const _0x2c5a0d = _0x28c56f.createElement("img");
            _0x2c5a0d.className = "tsp-generated-image tsp-inline-image";
            _0x2c5a0d.dataset.imageId = String(_0x230630);
            _0x2c5a0d.dataset.locationHash = _0x4c1d6f;
            const _0x47a69b = this._zoomRatio || 100;
            _0x2c5a0d.style.cssText = "max-width: " + _0x47a69b + "%; cursor: pointer; border-radius: 8px; margin: 0; min-height: 50px; background: rgba(122,162,247,0.1);";
            if (_0x1f5078) {
              if (_0x1f5078 instanceof Blob) {
                _0x2c5a0d.src = URL.createObjectURL(_0x1f5078);
              } else if (typeof _0x1f5078 === "string" && _0x1f5078.startsWith("data:image")) {
                const _0x16a347 = this._dataURLtoBlob(_0x1f5078);
                _0x2c5a0d.src = _0x16a347 ? URL.createObjectURL(_0x16a347) : _0x1f5078;
              } else {
                _0x2c5a0d.src = _0x1f5078;
              }
              _0x2c5a0d.dataset.isLoaded = "true";
              this._observeImage(_0x2c5a0d, true);
            } else {
              _0x2c5a0d.src = TRANSPARENT_PIXEL;
              _0x2c5a0d.dataset.isLoaded = "false";
              this._observeImage(_0x2c5a0d, false);
            }
            _0x34196d.appendChild(_0x2c5a0d);
          }
        });
      } catch (_0x50d886) {}
    });
    const _0x52f075 = _0x1f5078 instanceof Blob ? "Blob(" + _0x1f5078.size + ")" : "String(" + (_0x1f5078 || "").length + ")";
    this.ctx.log("image-gen", "UI 已更新: hash=" + _0x4c1d6f.substring(0, 8) + "..., id=" + _0x230630 + ", data=" + _0x52f075);
  }
  async deleteCachedImage(_0x3b4fe9) {
    this.ctx.log("image-gen", "请求删除图片 ID: " + _0x3b4fe9);
    if (!_0x3b4fe9) {
      return;
    }
    let _0x440c15 = null;
    for (const _0x2a4036 in this._locationToImageIdMap) {
      if (this._locationToImageIdMap[_0x2a4036] === _0x3b4fe9) {
        _0x440c15 = _0x2a4036;
        delete this._locationToImageIdMap[_0x2a4036];
        break;
      }
    }
    if (this.storageManager) {
      await this.storageManager.deleteImage(_0x3b4fe9);
    } else {
      await this.ctx.db.delete(StoreNames.IMAGE_CACHE, _0x3b4fe9);
    }
    this.ctx.log("image-gen", "图片 ID: " + _0x3b4fe9 + " 的删除流程已完成。");
    if (_0x440c15) {
      this.ctx.log("image-gen", "正在更新与 locationHash " + _0x440c15.substring(0, 8) + "... 关联的 DOM");
      const _0x2cfb5d = await this.ctx.db.getAll(StoreNames.IMAGE_CACHE);
      const _0x229901 = _0x2cfb5d.filter(_0x3c7e1c => _0x3c7e1c.locationHash === _0x440c15).sort((_0x3e5d4d, _0x18dcb9) => (_0x18dcb9.timestamp || 0) - (_0x3e5d4d.timestamp || 0));
      const _0x4af7b0 = document.querySelectorAll(".tsp-image-slot[data-location-hash=\"" + _0x440c15 + "\"]");
      for (const _0x43538c of _0x4af7b0) {
        if (_0x229901.length > 0) {
          const _0x43dc71 = _0x229901[0];
          this.ctx.log("image-gen", "找到历史图片 #" + _0x43dc71.id + " 进行替换");
          _0x43538c.dataset.imageId = String(_0x43dc71.id);
          const _0x554424 = _0x43538c.querySelector("img.tsp-generated-image");
          if (_0x554424) {
            _0x554424.dataset.imageId = String(_0x43dc71.id);
            _0x554424.src = TRANSPARENT_PIXEL;
            _0x554424.dataset.isLoaded = "false";
            this._observeImage(_0x554424, false);
          }
          this.updateCacheMapping(_0x440c15, _0x43dc71.id);
        } else {
          this.ctx.log("image-gen", "没有更多历史图片，将 Slot 恢复为生成按钮");
          const _0x134640 = _0x43538c.querySelector("button.tsp-regenerate-btn");
          if (_0x134640) {
            const _0x37944 = _0x134640.dataset.link || "";
            const _0x154f31 = _0x134640.dataset.matchIndex || "0";
            const _0x2fa5f6 = "<button class=\"tsp-inline-gen-btn\" data-link=\"" + this._escapeHtml(_0x37944) + "\" data-location-hash=\"" + _0x440c15 + "\" data-match-index=\"" + _0x154f31 + "\" title=\"点击生成图片\">\n                            <i class=\"fa-solid fa-image\"></i>\n                        </button>";
            _0x43538c.outerHTML = _0x2fa5f6;
            const _0x46c170 = document.querySelector(".tsp-inline-gen-btn[data-location-hash=\"" + _0x440c15 + "\"]");
            if (_0x46c170) {
              const _0x21596c = _0x46c170.closest(".mes");
              _0x46c170.addEventListener("click", _0xf8b8d4 => this._handleInlineButtonClick(_0xf8b8d4, _0x46c170, _0x21596c));
            }
          }
        }
      }
    }
  }
  async getCachedImage(_0x162088) {
    return await this.ctx.db.get(StoreNames.IMAGE_CACHE, _0x162088);
  }
  async deleteCachedImages(_0x333123) {
    this.ctx.log("image-gen", "请求批量删除 " + _0x333123.length + " 张图片");
    if (this.storageManager) {
      await this.storageManager.deleteImages(_0x333123);
      const _0x44bafa = new Set(_0x333123);
      for (const _0x1e56e8 in this._locationToImageIdMap) {
        if (_0x44bafa.has(this._locationToImageIdMap[_0x1e56e8])) {
          delete this._locationToImageIdMap[_0x1e56e8];
        }
      }
    } else {
      for (const _0x4cba34 of _0x333123) {
        await this.ctx.db.delete(StoreNames.IMAGE_CACHE, _0x4cba34);
      }
    }
  }
  getStorageMode() {
    if (this.storageManager) {
      return this.storageManager.getStorageMode();
    }
    return "browser";
  }
  async setStorageMode(_0x24c2cf) {
    this.ctx.log("image-gen", "设置存储模式: " + _0x24c2cf);
    if (this.storageManager) {
      await this.storageManager.setStorageMode(_0x24c2cf);
    }
  }
  async getStorageStats() {
    if (this.storageManager) {
      return await this.storageManager.getStorageStats();
    }
    return {
      total: 0,
      browserCount: 0,
      tavernCount: 0,
      browserSizeMB: "0.00",
      currentMode: "browser"
    };
  }
  async migrateStorage(_0x24095c, _0x551d43) {
    if (this.storageManager) {
      return await this.storageManager.migrateStorage(_0x24095c, _0x551d43);
    }
    return {
      success: 0,
      failed: 0
    };
  }
  async getCachedImage(_0x568395) {
    const _0x43eeee = Number(_0x568395);
    if (isNaN(_0x43eeee)) {
      return null;
    }
    if (this.storageManager) {
      return await this.storageManager.getImage(_0x43eeee);
    }
    return await this.ctx.db.get(StoreNames.IMAGE_CACHE, _0x43eeee);
  }
  async getCacheMetadata(_0x2e91ab = {}) {
    const {
      pageSize = 20,
      page = 1,
      filterMode = "",
      filterDateStart = "",
      filterDateEnd = ""
    } = _0x2e91ab;
    let _0x244a31 = [];
    if (this.storageManager) {
      _0x244a31 = await this.storageManager.getAllMetadata();
    } else {
      _0x244a31 = (await this.ctx.db.getAll(StoreNames.IMAGE_CACHE)) || [];
    }
    let _0x2681a7 = _0x244a31;
    if (filterMode && filterMode !== "all") {
      _0x2681a7 = _0x2681a7.filter(_0x19c6d6 => _0x19c6d6.mode === filterMode);
    }
    if (filterDateStart) {
      const _0x270fdc = filterDateStart.split("-");
      if (_0x270fdc.length === 3) {
        const _0x1beade = new Date(Number(_0x270fdc[0]), Number(_0x270fdc[1]) - 1, Number(_0x270fdc[2]), 0, 0, 0, 0);
        const _0x1d7a84 = _0x1beade.getTime();
        _0x2681a7 = _0x2681a7.filter(_0x197813 => (_0x197813.timestamp || 0) >= _0x1d7a84);
      }
    }
    if (filterDateEnd) {
      const _0x33706e = filterDateEnd.split("-");
      if (_0x33706e.length === 3) {
        const _0x3e7354 = new Date(Number(_0x33706e[0]), Number(_0x33706e[1]) - 1, Number(_0x33706e[2]), 23, 59, 59, 999);
        const _0x29c137 = _0x3e7354.getTime();
        _0x2681a7 = _0x2681a7.filter(_0x403d38 => (_0x403d38.timestamp || 0) <= _0x29c137);
      }
    }
    _0x2681a7.sort((_0x5e7b10, _0x44e0bf) => {
      const _0x2a9ed7 = Number(_0x5e7b10.timestamp) || 0;
      const _0x564605 = Number(_0x44e0bf.timestamp) || 0;
      if (_0x2a9ed7 === _0x564605) {
        return _0x44e0bf.id - _0x5e7b10.id;
      }
      return _0x564605 - _0x2a9ed7;
    });
    const _0x48ecd6 = (page - 1) * pageSize;
    const _0x539131 = _0x48ecd6 + pageSize;
    const _0x16b5e5 = _0x2681a7.slice(_0x48ecd6, _0x539131);
    return {
      items: _0x16b5e5.map(_0x202be1 => ({
        id: _0x202be1.id,
        locationHash: _0x202be1.locationHash,
        timestamp: _0x202be1.timestamp,
        time: _0x202be1.timestamp ? new Date(_0x202be1.timestamp).toLocaleString() : _0x202be1.time || "",
        mode: _0x202be1.mode,
        hasEditedPrompt: !!_0x202be1.editedPrompt,
        storageMode: _0x202be1.storageMode,
        thumbnailPath: _0x202be1.thumbnailPath,
        thumbnailData: _0x202be1.thumbnailData
      })),
      total: _0x2681a7.length,
      page: page,
      pageSize: pageSize
    };
  }
  insertImageToChat(_0x5614ab) {
    const _0x179b65 = document.getElementById("chat");
    if (_0x179b65) {
      const _0x5d1e93 = _0x179b65.querySelector(".mes:last-child .mes_text");
      if (_0x5d1e93) {
        const _0x520a89 = document.createElement("img");
        _0x520a89.src = _0x5614ab;
        _0x520a89.className = "tsp-generated-image";
        _0x520a89.style.cssText = "max-width: 100%; border-radius: 8px; margin-top: 10px; cursor: pointer;";
        _0x520a89.addEventListener("click", () => window.open(_0x5614ab, "_blank"));
        _0x5d1e93.appendChild(_0x520a89);
      }
    }
  }
  async _onGenerationEnded() {
    const _0x51002b = this.ctx.getModule("aiProcessor");
    const _0x4f3f24 = _0x51002b?.config || _0x51002b?.settings || {};
    if (!_0x4f3f24.chatInsertionAutoClick) {
      return;
    }
    if (!_0x51002b) {
      return;
    }
    if (this._isCharacterSwitching) {
      this.ctx.log("image-gen", "[自动点击] 终止：检测到角色卡切换中，等待缓存加载完成");
      return;
    }
    if (this._wasStoppedManually) {
      this.ctx.log("image-gen", "[自动点击] 终止：检测到 GENERATION_STOPPED 信号 (用户手动中断)");
      return;
    }
    const _0x22fdf5 = Date.now() - (this._genStartTime || 0);
    if (_0x22fdf5 < 18000) {
      this.ctx.log("image-gen", "[自动点击] 终止：生成耗时过短 (" + _0x22fdf5 + "ms)，判定为无效生成或瞬时错误");
      return;
    }
    this.ctx.log("image-gen", "[自动点击] 检测到生成结束事件，准备执行...");
    setTimeout(() => {
      if (!chat || chat.length === 0) {
        this.ctx.log("image-gen", "[自动点击] 终止：聊天记录为空");
        return;
      }
      const _0x5ca244 = chat[chat.length - 1];
      if (_0x5ca244.is_user) {
        this.ctx.log("image-gen", "[自动点击] 终止：最后一条消息是用户发言（可能生成已中止或报错）");
        return;
      }
      const _0x5e90c6 = _0x5ca244.mes ? _0x5ca244.mes.trim() : "";
      if (!_0x5e90c6 || _0x5e90c6 === "..." || _0x5e90c6.length < 100) {
        this.ctx.log("image-gen", "[自动点击] 终止：AI 回复内容无效、为空或过短");
        return;
      }
      if (document.body.dataset.generating === "true") {
        this.ctx.log("image-gen", "[自动点击] 暂停：检测到系统仍标记为生成中 (data-generating=true)");
        return;
      }
      this.scanAndInject();
      const _0x21d663 = document.getElementById("chat");
      if (!_0x21d663) {
        return;
      }
      const _0x1989c8 = _0x21d663.querySelectorAll(".tsp-ai-gen-btn");
      if (_0x1989c8.length === 0) {
        this.ctx.log("image-gen", "[自动点击] 未找到任何 AI 生成按钮");
        return;
      }
      const _0x482673 = _0x1989c8[_0x1989c8.length - 1];
      if (_0x482673.innerHTML.includes("fa-spinner")) {
        this.ctx.log("image-gen", "[自动点击] 最后一个按钮已在运行中，跳过");
        return;
      }
      this.ctx.log("image-gen", "[自动点击] 触发最后一个 AI 按钮点击");
      _0x482673.click();
    }, 1500);
  }
  _updateButtonStatus(_0x565e5d, _0x1441d4, _0x5dc7af = "") {
    if (!_0x565e5d) {
      return;
    }
    try {
      const _0x2c8f7c = _0x565e5d.ownerDocument;
      if (!_0x2c8f7c || !_0x2c8f7c.contains(_0x565e5d)) {
        return;
      }
    } catch (_0x5cb859) {
      return;
    }
    switch (_0x1441d4) {
      case "loading":
        _0x565e5d.disabled = true;
        _0x565e5d.innerHTML = "<i class=\"fa-solid fa-spinner fa-spin\"></i> " + (_0x5dc7af || "生成中...");
        break;
      case "default":
        _0x565e5d.disabled = false;
        _0x565e5d.innerHTML = "<i class=\"fa-solid fa-image\"></i> 生成图片";
        break;
    }
  }
  async setMode(_0x239002) {
    if (["sd", "nai", "comfyui", "other"].includes(_0x239002)) {
      this.settings.currentMode = _0x239002;
      await this.saveSettings();
      const _0x4352f5 = {
        key: "currentMode",
        value: _0x239002
      };
      this.ctx.events.emit(EventTypes.SETTINGS_CHANGED, _0x4352f5);
      this.ctx.helpers.showToast("已切换到 " + _0x239002.toUpperCase() + " 模式", "info");
    }
  }
  getMode() {
    return this.settings.currentMode;
  }
  async updateSettings(_0x5e872b) {
    this.settings = this._deepMerge(this.settings, _0x5e872b);
    await this.saveSettings();
  }
  _removeTrailingSlash(_0x2341bf) {
    return _0x2341bf.replace(/\/+$/, "");
  }
  _isVideoContent(_0x10d20e) {
    if (!_0x10d20e) {
      return false;
    }
    if (typeof _0x10d20e === "string" && _0x10d20e.match(/^data:video\//i)) {
      return true;
    }
    if (typeof _0x10d20e === "object" && _0x10d20e instanceof Blob && _0x10d20e.type.startsWith("video/")) {
      return true;
    }
    return false;
  }
  _sleep(_0x564e71) {
    return new Promise(_0x42ecb9 => setTimeout(_0x42ecb9, _0x564e71));
  }
  _getCurrentFormattedTime() {
    const _0x4d015e = new Date();
    const _0x3e2004 = _0x349300 => String(_0x349300).padStart(2, "0");
    return _0x4d015e.getFullYear() + "-" + _0x3e2004(_0x4d015e.getMonth() + 1) + "-" + _0x3e2004(_0x4d015e.getDate()) + "-" + _0x3e2004(_0x4d015e.getHours()) + "-" + _0x3e2004(_0x4d015e.getMinutes()) + "-" + _0x3e2004(_0x4d015e.getSeconds());
  }
  _cleanPromptText(_0x1598c8) {
    if (!_0x1598c8) {
      return "";
    }
    return _0x1598c8.replace(/,(\s*,)+/g, ",").replace(/, /g, ",").replace(/ ,/g, ",").replace(/(^,\s*)|(\s*,$)/g, "").replace(/\s+/g, " ").trim();
  }
  _formatComfyPrompt(_0x299a5b) {
    if (!_0x299a5b) {
      return "";
    }
    _0x299a5b = _0x299a5b.replace(/<lora:([^:>]+):([0-9.-]+)>/gi, (_0x42488d, _0x22b3dc, _0x55aa7e) => {
      if (!/\.(safetensors|pt|ckpt|bin)$/i.test(_0x22b3dc)) {
        _0x22b3dc += ".safetensors";
      }
      return "<lora:" + _0x22b3dc + ":1:" + _0x55aa7e + ">";
    });
    _0x299a5b = _0x299a5b.replace(/<wlr:([^:>]+):([0-9.-]+)>/gi, (_0x31524d, _0x18c14d, _0xdbc551) => {
      return "<wlr:" + _0x18c14d + ":1:" + _0xdbc551 + ">";
    });
    return _0x299a5b;
  }
  _processPlaceholders(_0x5d1d1a, _0x4f9791) {
    if (!_0x5d1d1a || typeof _0x5d1d1a !== "object") {
      return _0x5d1d1a;
    }
    const _0x3e03a7 = Array.isArray(_0x5d1d1a) ? [..._0x5d1d1a] : {
      ..._0x5d1d1a
    };
    for (const [_0x44f1f7, _0x3fef1d] of Object.entries(_0x3e03a7)) {
      if (typeof _0x3fef1d === "string") {
        let _0x2c3bb6 = _0x3fef1d;
        for (const _0xf3958 of _0x4f9791) {
          const _0x3723b9 = _0xf3958.name;
          const _0x11cc42 = _0xf3958.selectedValue || _0xf3958.value;
          if (_0x2c3bb6.includes(_0x3723b9)) {
            _0x2c3bb6 = _0x2c3bb6.split(_0x3723b9).join(_0x11cc42);
          }
        }
        _0x3e03a7[_0x44f1f7] = _0x2c3bb6;
      } else if (typeof _0x3fef1d === "object" && _0x3fef1d !== null) {
        _0x3e03a7[_0x44f1f7] = this._processPlaceholders(_0x3fef1d, _0x4f9791);
      }
    }
    return _0x3e03a7;
  }
  _buildDefaultPayload(_0x2c95b7, _0x350ed0, _0x3d91cd, _0x4008e9) {
    const _0x153287 = {
      url: _0x4008e9
    };
    const _0xdceb98 = {
      type: "image_url",
      image_url: _0x153287
    };
    const _0x340b7a = {
      model: _0x2c95b7.model || "gpt-3.5-turbo",
      messages: [{
        role: "user",
        content: _0x3d91cd ? [{
          type: "text",
          text: _0x350ed0
        }, _0xdceb98] : _0x350ed0
      }],
      stream: false
    };
    return _0x340b7a;
  }
  _extractBase64Data(_0x3fb81a) {
    if (!_0x3fb81a) {
      return "";
    }
    const _0x3bd087 = _0x3fb81a.indexOf(",");
    if (_0x3bd087 === -1) {
      return _0x3fb81a;
    }
    return _0x3fb81a.substring(_0x3bd087 + 1);
  }
  async saveI2IData(_0x35794f, _0x7600f0, _0x488258) {
    if (!_0x35794f) {
      return;
    }
    try {
      const _0x54c02b = {
        id: _0x35794f,
        imageData: _0x7600f0,
        maskData: _0x488258,
        timestamp: Date.now()
      };
      await this.ctx.db.put(StoreNames.I2I_CACHE, _0x54c02b);
      this.ctx.log("image-gen", "图生图数据已保存: " + _0x35794f.substring(0, 12) + "...");
    } catch (_0x2f7433) {
      this.ctx.error("image-gen", "保存图生图数据失败:", _0x2f7433);
    }
  }
  async getI2IData(_0x5a9283) {
    if (!_0x5a9283) {
      return null;
    }
    try {
      return await this.ctx.db.get(StoreNames.I2I_CACHE, _0x5a9283);
    } catch (_0x44afff) {
      this.ctx.error("image-gen", "读取图生图数据失败:", _0x44afff);
      return null;
    }
  }
  async clearI2IData(_0x464817) {
    if (!_0x464817) {
      return;
    }
    try {
      await this.ctx.db.delete(StoreNames.I2I_CACHE, _0x464817);
      this.ctx.log("image-gen", "图生图数据已清除: " + _0x464817.substring(0, 12) + "...");
    } catch (_0xde3a7a) {
      this.ctx.error("image-gen", "清除图生图数据失败:", _0xde3a7a);
    }
  }
  async clearAllI2IData() {
    try {
      const _0x49445c = await this.ctx.db.getAll(StoreNames.I2I_CACHE);
      for (const _0x2d5cb8 of _0x49445c || []) {
        await this.ctx.db.delete(StoreNames.I2I_CACHE, _0x2d5cb8.id);
      }
      this.ctx.log("image-gen", "所有图生图缓存已清除");
    } catch (_0x25bbfa) {
      this.ctx.error("image-gen", "清除所有图生图缓存失败:", _0x25bbfa);
    }
  }
  async _resolveImageToDataURL(_0x510056) {
    if (!_0x510056) {
      return null;
    }
    if (_0x510056.startsWith("data:")) {
      return _0x510056;
    }
    if (_0x510056.startsWith("/user/") || _0x510056.startsWith("user/")) {
      this.ctx.log("image-gen", "正在将服务器路径转换为 DataURL: " + _0x510056);
      try {
        const _0x1accbe = _0x510056.startsWith("/") ? _0x510056 : "/" + _0x510056;
        const _0x2c9889 = await fetch(_0x1accbe, {
          method: "GET",
          headers: getRequestHeaders()
        });
        if (!_0x2c9889.ok) {
          throw new Error("从服务器获取图片失败: " + _0x2c9889.status);
        }
        const _0x2bb5d9 = await _0x2c9889.blob();
        return await this._blobToDataURL(_0x2bb5d9);
      } catch (_0x2d9a27) {
        this.ctx.error("image-gen", "解析服务器路径 \"" + _0x510056 + "\" 失败:", _0x2d9a27);
        return null;
      }
    }
    return "data:image/png;base64," + _0x510056;
  }
  _extractBase64(_0x246cd7) {
    if (!_0x246cd7) {
      return "";
    }
    if (_0x246cd7.includes(",")) {
      return _0x246cd7.split(",")[1];
    }
    return _0x246cd7;
  }
  async _processDirectorImage(_0x1b2067) {
    if (!_0x1b2067) {
      return "";
    }
    const _0x19cea8 = _0x1b2067.startsWith("data:") ? _0x1b2067 : "data:image/png;base64," + _0x1b2067;
    return new Promise((_0x2c774c, _0x7a6d4a) => {
      const _0x1013b5 = new Image();
      _0x1013b5.onload = () => {
        const _0x12d624 = document.createElement("canvas");
        const _0x1fb7a2 = _0x12d624.getContext("2d");
        const _0x4d109e = _0x1013b5.naturalWidth / _0x1013b5.naturalHeight;
        let _0x24e6a9;
        let _0x124ab8;
        if (_0x4d109e > 1.1) {
          _0x24e6a9 = 1536;
          _0x124ab8 = 1024;
        } else if (_0x4d109e < 0.9) {
          _0x24e6a9 = 1024;
          _0x124ab8 = 1536;
        } else {
          _0x24e6a9 = 1472;
          _0x124ab8 = 1472;
        }
        _0x12d624.width = _0x24e6a9;
        _0x12d624.height = _0x124ab8;
        _0x1fb7a2.drawImage(_0x1013b5, 0, 0, _0x24e6a9, _0x124ab8);
        this.ctx.log("image-gen", "Director参考图缩放: " + _0x1013b5.naturalWidth + "x" + _0x1013b5.naturalHeight + " -> " + _0x24e6a9 + "x" + _0x124ab8);
        _0x2c774c(_0x12d624.toDataURL("image/png"));
      };
      _0x1013b5.onerror = _0x126597 => {
        console.error("处理Director参考图失败", _0x126597);
        _0x2c774c(_0x19cea8);
      };
      _0x1013b5.src = _0x19cea8;
    });
  }
  _isLikelyCustomFrontend(_0x37020d, _0x43bf0a) {
    const _0x10cc3b = _0x43bf0a || _0x37020d;
    const _0x20942d = _0x10cc3b.querySelector("iframe") !== null;
    if (_0x20942d) {
      return true;
    }
    const _0x67dec1 = _0x37020d.innerHTML;
    const _0x501e43 = _0x67dec1.includes("<html") && _0x67dec1.includes("<body") || _0x67dec1.includes("class=\"dc-root\"") || _0x67dec1.includes("id=\"dcSource\"");
    return _0x501e43;
  }
  _scanIframesInMessage(_0x4ec0ea, _0xd4198e) {
    const _0x3ed206 = _0xd4198e.dataset.mesid || _0xd4198e.getAttribute("mesid") || "";
    const _0x59b026 = _0xd4198e.dataset.timestamp || _0xd4198e.getAttribute("timestamp") || "";
    const _0x1572c6 = _0xd4198e.dataset.chName || _0xd4198e.getAttribute("ch_name") || "";
    const _0x560eda = _0x59b026 + "-" + _0x1572c6 + "-" + _0x3ed206;
    const _0x761256 = this._processContainerRecursively(_0x4ec0ea, _0xd4198e, _0x560eda);
    const _0x256aa4 = _0xd4198e.querySelectorAll("iframe");
    if (_0x256aa4.length > 0) {
      this._processIframesAsync(_0x256aa4, _0xd4198e, _0x560eda);
    }
    return _0x761256;
  }
  async _processIframesAsync(_0x12a9ac, _0x1b9422, _0x29ba79) {
    for (let _0x9de0da = 0; _0x9de0da < _0x12a9ac.length; _0x9de0da++) {
      const _0x4aa1c6 = _0x12a9ac[_0x9de0da];
      try {
        await this._waitForIframeLoad(_0x4aa1c6);
        const _0x30c218 = this._getIframeDocument(_0x4aa1c6);
        if (!_0x30c218 || !_0x30c218.body) {
          continue;
        }
        this._processContainerRecursively(_0x30c218.body, _0x1b9422, _0x29ba79);
        this._injectIframeStyles(_0x30c218);
        const _0x50c577 = () => {
          if (!_0x30c218.body) {
            return;
          }
          if (!_0x4aa1c6._tspImageObserver) {
            const _0x1d1442 = this._createObserverCallback();
            const _0xb06d70 = _0x30c218.scrollingElement || _0x30c218.body;
            const _0x3cbd07 = {
              root: _0xb06d70,
              rootMargin: "800px 0px 800px 0px"
            };
            _0x4aa1c6._tspImageObserver = new IntersectionObserver(_0x1d1442, _0x3cbd07);
          }
          const _0x20f2d8 = _0x30c218.querySelectorAll("img.tsp-inline-image[data-is-loaded=\"false\"]:not([data-observed=\"true\"])");
          if (_0x20f2d8.length > 0) {
            _0x20f2d8.forEach(_0x34c4c4 => {
              try {
                _0x34c4c4.dataset.isLoaded = "false";
                _0x4aa1c6._tspImageObserver.observe(_0x34c4c4);
                _0x34c4c4.dataset.observed = "true";
              } catch (_0x5e9ea2) {
                console.warn("Iframe 观察失败，回退到强制显示:", _0x5e9ea2);
                _0x34c4c4.style.height = "auto";
                _0x34c4c4.style.minHeight = "";
                const _0x38117d = _0x34c4c4.dataset.imageId;
                if (_0x38117d) {
                  this.getCachedImage(parseInt(_0x38117d)).then(_0x500896 => {
                    if (_0x500896 && _0x500896.imageData) {
                      if (_0x500896.imageData instanceof Blob) {
                        _0x34c4c4.src = URL.createObjectURL(_0x500896.imageData);
                      } else {
                        _0x34c4c4.src = _0x500896.imageData;
                      }
                    }
                  });
                }
                _0x34c4c4.dataset.isLoaded = "true";
              }
            });
          }
        };
        _0x50c577();
        setTimeout(_0x50c577, 1000);
        this._setupIframeObserver(_0x4aa1c6, _0x1b9422, _0x29ba79, _0x9de0da);
      } catch (_0x4f8027) {
        this.ctx.warn("image-gen", "处理 iframe #" + _0x9de0da + " 时出错:", _0x4f8027.message);
      }
    }
  }
  _simpleHash(_0x5330dd) {
    let _0x28f822 = 0;
    for (let _0x45048e = 0; _0x45048e < _0x5330dd.length; _0x45048e++) {
      const _0x5e8607 = _0x5330dd.charCodeAt(_0x45048e);
      _0x28f822 = (_0x28f822 << 5) - _0x28f822 + _0x5e8607;
      _0x28f822 = _0x28f822 & _0x28f822;
    }
    return _0x28f822.toString(16);
  }
  _setupIframeObserver(_0x3a27e0, _0x263469, _0xa5344, _0x3e35cf) {
    try {
      const _0xf44487 = this._getIframeDocument(_0x3a27e0);
      if (!_0xf44487 || !_0xf44487.body) {
        return;
      }
      const _0x182e5d = new MutationObserver(() => {
        const _0x486d3a = _0xf44487.body.textContent || "";
        if (_0x486d3a.includes(this._analysisBegins)) {
          _0x3a27e0.dataset.tspProcessed = "";
          const _0x5625f7 = _0xf44487.body.querySelectorAll(".log-entry");
          _0x5625f7.forEach(_0x329b1a => {
            const _0x12637a = _0x329b1a;
            if (_0x12637a.dataset) {
              _0x12637a.dataset.tspLogProcessed = "";
            }
          });
          const _0x628511 = this._processContainerRecursively(_0xf44487.body, _0x263469, _0xa5344);
          if (_0x628511.length > 0) {
            this._injectIframeStyles(_0xf44487);
            _0x3a27e0.dataset.tspProcessed = "true";
          }
        }
        setTimeout(() => {
          const _0x4b55ea = () => {
            if (!_0xf44487.body) {
              return;
            }
            if (_0x3a27e0._tspImageObserver) {
              _0x3a27e0._tspImageObserver.disconnect();
            }
            const _0x303e67 = this._createObserverCallback();
            const _0x2b052c = _0xf44487.scrollingElement || _0xf44487.body;
            const _0x5421f1 = {
              root: _0x2b052c,
              rootMargin: "800px 0px 800px 0px"
            };
            _0x3a27e0._tspImageObserver = new IntersectionObserver(_0x303e67, _0x5421f1);
            const _0x57be4f = _0xf44487.querySelectorAll("img.tsp-inline-image[data-is-loaded=\"false\"]");
            _0x57be4f.forEach(_0x5aceef => {
              try {
                _0x5aceef.dataset.observed = "true";
                _0x3a27e0._tspImageObserver.observe(_0x5aceef);
              } catch (_0x14a3df) {
                console.warn("重新观察图片失败:", _0x14a3df);
              }
            });
          };
          _0x4b55ea();
        }, 500);
      });
      _0x182e5d.observe(_0xf44487.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
      _0x3a27e0.dataset.tspObserverSet = "true";
    } catch (_0x4ec143) {
      this.ctx.warn("image-gen", "设置 iframe 观察器失败:", _0x4ec143.message);
    }
  }
  _getIframeDocument(_0x3ceb88) {
    try {
      if (_0x3ceb88.contentDocument) {
        return _0x3ceb88.contentDocument;
      }
      if (_0x3ceb88.contentWindow?.document) {
        return _0x3ceb88.contentWindow.document;
      }
    } catch (_0x4201ce) {}
    return null;
  }
  _waitForIframeLoad(_0x2caf53) {
    return new Promise(_0x5e074c => {
      try {
        const _0x24d642 = _0x2caf53.contentDocument || _0x2caf53.contentWindow?.document;
        if (_0x24d642 && _0x24d642.readyState === "complete") {
          _0x5e074c();
          return;
        }
      } catch (_0x428d59) {}
      const _0x48ed3a = setTimeout(() => {
        this.ctx.log("image-gen", "iframe 加载超时，继续处理");
        _0x5e074c();
      }, 10000);
      const _0x4e4004 = () => {
        clearTimeout(_0x48ed3a);
        setTimeout(_0x5e074c, 500);
      };
      _0x2caf53.addEventListener("load", _0x4e4004, {
        once: true
      });
      setTimeout(() => {
        try {
          const _0x2334ef = _0x2caf53.contentDocument || _0x2caf53.contentWindow?.document;
          if (_0x2334ef && _0x2334ef.body && _0x2334ef.body.innerHTML.length > 0) {
            clearTimeout(_0x48ed3a);
            _0x2caf53.removeEventListener("load", _0x4e4004);
            _0x5e074c();
          }
        } catch (_0x30c1d8) {}
      }, 1000);
    });
  }
  _injectIframeStyles(_0x1376ca) {
    const _0x31889f = document.body.classList.contains("tsp-mode-double-click");
    _0x1376ca.body.classList.toggle("tsp-mode-double-click", _0x31889f);
    if (!_0x1376ca._tspClassObserver) {
      const _0x1f0f49 = new MutationObserver(_0x3b2499 => {
        for (const _0x29eedb of _0x3b2499) {
          if (_0x29eedb.attributeName === "class") {
            const _0xbddac6 = document.body.classList.contains("tsp-mode-double-click");
            _0x1376ca.body.classList.toggle("tsp-mode-double-click", _0xbddac6);
          }
        }
      });
      _0x1f0f49.observe(document.body, {
        attributes: true,
        attributeFilter: ["class"]
      });
      _0x1376ca._tspClassObserver = _0x1f0f49;
    }
    if (_0x1376ca.getElementById("tsp-iframe-styles")) {
      return;
    }
    if (!_0x1376ca.querySelector("link[href*=\"font-awesome\"]")) {
      const _0x4c71c7 = _0x1376ca.createElement("link");
      _0x4c71c7.rel = "stylesheet";
      _0x4c71c7.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css";
      _0x1376ca.head.appendChild(_0x4c71c7);
    }
    const _0x25063b = getComputedStyle(document.documentElement);
    const _0x141a6e = _0x25063b.getPropertyValue("--tsp-btn-gen-grad-1").trim() || "#f0c36a";
    const _0x15a5d9 = _0x25063b.getPropertyValue("--tsp-btn-gen-grad-2").trim() || "#d49a3a";
    const _0x5536bf = _0x25063b.getPropertyValue("--tsp-btn-gen-text").trim() || "#1b1b1b";
    const _0x382d51 = _0x25063b.getPropertyValue("--tsp-border").trim() || "rgba(128,128,128,0.3)";
    const _0x5e73b0 = _0x25063b.getPropertyValue("--tsp-bg-main").trim() || "#1a1b26";
    const _0x58b642 = _0x25063b.getPropertyValue("--tsp-accent-primary").trim() || "#7aa2f7";
    const _0x4ed3e8 = _0x1376ca.createElement("style");
    _0x4ed3e8.id = "tsp-iframe-styles";
    _0x4ed3e8.textContent = "\n            /* ==================== 容器布局 ==================== */\n            .tsp-image-slot {\n                display: inline-flex !important;\n                flex-direction: column;\n                align-items: flex-start;\n                gap: 0;\n                vertical-align: top;\n                margin: 4px 2px;\n                position: relative;\n                max-width: 100%;\n            }\n\n            /* ==================== 按钮基础样式 ==================== */\n            .tsp-inline-gen-btn {\n                display: inline-flex;\n                align-items: center;\n                justify-content: center;\n                min-height: 30px;\n                margin: 0;\n                padding: 4px 10px;\n                border: 1px solid rgba(0, 0, 0, 0.2);\n                border-radius: 8px;\n                background: linear-gradient(160deg, " + _0x141a6e + ", " + _0x15a5d9 + ");\n                color: " + _0x5536bf + ";\n                font-family: inherit;\n                font-size: 14px;\n                cursor: pointer;\n                box-shadow: 0 2px 8px rgba(0,0,0, 0.2);\n                transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease, filter 0.15s ease;\n                vertical-align: middle;\n                white-space: nowrap;\n                text-decoration: none;\n                z-index: 10;\n            }\n\n            .tsp-inline-gen-btn:hover {\n                filter: brightness(1.1);\n                background: linear-gradient(160deg, " + _0x141a6e + ", " + _0x15a5d9 + ");\n                transform: translateY(-1px) scale(1.02);\n                box-shadow: 0 4px 12px rgba(0,0,0, 0.3);\n            }\n\n            .tsp-inline-gen-btn:active {\n                transform: translateY(1px);\n            }\n\n            .tsp-inline-gen-btn:disabled {\n                opacity: 0.6;\n                cursor: wait;\n                transform: none;\n                box-shadow: none;\n                background: #888;\n            }\n\n            .tsp-inline-gen-btn i {\n                margin-right: 6px;\n                font-size: 14px;\n            }\n\n            /* ==================== 重新生成按钮特化样式 ==================== */\n            .tsp-regenerate-btn {\n                margin-bottom: 0 !important;\n                border-bottom-left-radius: 0;\n                border-bottom-right-radius: 0;\n                border-bottom: none;\n                font-size: 12px !important;\n                padding: 2px 8px !important;\n                min-height: 24px !important;\n                box-shadow: none;\n                background: linear-gradient(160deg, " + _0x141a6e + ", " + _0x15a5d9 + ");\n            }\n\n            /* ==================== 图片样式 ==================== */\n            .tsp-generated-image, .tsp-inline-image {\n                display: block;\n                max-width: 100%;\n                height: auto;\n                border-radius: 8px;\n                border-top-left-radius: 0;\n                margin-top: 0 !important;\n                cursor: pointer;\n                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);\n                transition: transform 0.2s ease, box-shadow 0.2s ease;\n                min-height: 50px;\n                background: rgba(122,162,247,0.1);\n            }\n\n            .tsp-generated-image:hover, .tsp-inline-image:hover {\n                transform: scale(1.01);\n                box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);\n            }\n\n            .tsp-inline-image.swiping {\n                transition: transform 0.1s ease;\n            }\n\n            @keyframes tsp-spin {\n                0% { transform: rotate(0deg); }\n                100% { transform: rotate(360deg); }\n            }\n            .tsp-inline-gen-btn .fa-spin {\n                animation: tsp-spin 1s linear infinite;\n            }\n\n            /* ==================== 隐藏模式 ==================== */\n            body.tsp-mode-double-click .tsp-regenerate-btn {\n                display: none !important;\n            }\n\n            body.tsp-mode-double-click .tsp-generated-image {\n                border-top-left-radius: 8px;\n            }\n\n            /* ==================== [新增] 隐私模式折叠层样式 (适配 Iframe) ==================== */\n            .tsp-privacy-container {\n                margin: 10px 0;\n                border: 1px solid " + _0x382d51 + ";\n                border-radius: 10px;\n                background: rgba(0, 0, 0, 0.05);\n                overflow: hidden;\n                /* 简化过渡效果 */\n                transition: border-color 0.3s ease, box-shadow 0.3s ease;\n\n                /* 核心布局修复 */\n                display: inline-flex;\n                flex-direction: column;\n\n                /* [修改] 强制高度适应内容，解决缩放后容器过高问题 */\n                width: fit-content;\n                height: fit-content !important;\n                min-height: 0;\n\n                min-width: 0;\n                max-width: 100%;\n\n                /* 简化阴影效果 */\n                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);\n                /* 添加硬件加速 */\n                transform: translateZ(0);\n            }\n\n            /* 未展开时的边框高亮 */\n            .tsp-privacy-container:not(.expanded) {\n                border-color: " + _0x58b642 + ";\n                box-shadow: 0 0 8px " + _0x58b642 + "33;\n            }\n\n            /* 标题栏 */\n            .tsp-privacy-toggle {\n                padding: 8px 15px;\n                cursor: pointer;\n                display: flex;\n                align-items: center;\n                gap: 10px;\n                font-size: 13px;\n                font-weight: bold;\n                color: " + _0x58b642 + ";\n                background: linear-gradient(90deg, rgba(0,0,0,0.05), transparent);\n                user-select: none;\n                position: relative;\n\n                /* [修改] 确保标题栏高度稳定 */\n                flex-shrink: 0;\n            }\n\n            .tsp-privacy-toggle:hover {\n                background: rgba(0,0,0,0.1);\n            }\n\n            .tsp-privacy-toggle::after {\n                content: '';\n                position: absolute;\n                top: 0; left: 0; right: 0; height: 1px;\n                background: " + _0x58b642 + ";\n                opacity: 0.5;\n                /* 移除扫描线动画 */\n                /* animation: tsp-scan 3s infinite linear; */\n            }\n\n            .tsp-privacy-toggle .tsp-chevron {\n                margin-left: auto;\n                transition: transform 0.3s ease;\n            }\n\n            .tsp-privacy-container.expanded .tsp-chevron {\n                transform: rotate(180deg);\n            }\n\n            /* 内容区域 */\n            .tsp-privacy-content {\n                display: none;\n                padding: 12px;\n                border-top: 1px solid " + _0x382d51 + ";\n                background: " + _0x5e73b0 + ";\n                /* 移除淡入动画，使用简单的过渡效果 */\n                /* animation: tsp-fade-in 0.4s ease; */\n                opacity: 0;\n                transform: translateY(-5px);\n                transition: opacity 0.3s ease, transform 0.3s ease;\n\n                /* [修改] 确保宽度撑满容器，高度自动适应 */\n                width: 100%;\n                height: auto;\n                min-height: 0;\n\n                box-sizing: border-box;\n\n                /* [新增] 使用 Flex 布局使内容紧凑 */\n                flex-direction: column;\n                align-items: center; /* 居中内容，防止图片宽度缩小时偏左 */\n            }\n\n            .tsp-privacy-container.expanded .tsp-privacy-content {\n                /* [修改] 展开时使用 Flex 而不是 Block */\n                display: flex;\n                opacity: 1;\n                transform: translateY(0);\n            }\n\n            /* 展开时更改图标 - 注意：iframe 内注入 fontawesome 内容需要双反斜杠转义 */\n            .tsp-privacy-container.expanded .tsp-privacy-toggle i:first-child::before {\n                content: \"\\f06e\";\n            }\n\n            /* 展开时更改文字 (CSS 技巧) */\n            .tsp-privacy-container.expanded .tsp-privacy-toggle span {\n                visibility: hidden;\n                position: relative;\n            }\n            .tsp-privacy-container.expanded .tsp-privacy-toggle span::after {\n                content: \"可视化层已展开\";\n                visibility: visible;\n                position: absolute;\n                left: 0;\n                top: 0;\n                white-space: nowrap;\n            }\n\n            .tsp-privacy-toggle span {\n                white-space: nowrap;\n                overflow: hidden;\n                text-overflow: ellipsis;\n                max-width: 100%;\n            }\n\n            /* 确保内容中的图片撑满容器 */\n            .tsp-privacy-container .tsp-generated-image,\n            .tsp-privacy-container .tsp-inline-image {\n                max-width: 100% !important;\n                /* [新增] 强制高度自动，配合容器的高度适应 */\n                height: auto !important;\n            }\n\n            /* 移除不必要的动画 */\n            /* @keyframes tsp-scan {\n                0% { top: 0%; opacity: 0; }\n                50% { opacity: 0.5; }\n                100% { top: 100%; opacity: 0; }\n            } */\n\n            /* @keyframes tsp-fade-in {\n                from { opacity: 0; transform: translateY(-5px); }\n                to { opacity: 1; transform: translateY(0); }\n            } */\n\n            @keyframes tsp-fade-in {\n                from { opacity: 0; transform: translateY(-5px); }\n                to { opacity: 1; transform: translateY(0); }\n            }\n        ";
    _0x1376ca.head.appendChild(_0x4ed3e8);
  }
  _processContainerRecursively(_0x53c720, _0x46c56a, _0xc4c5d0) {
    const _0x4b33a5 = [];
    const _0x366de4 = ["SCRIPT", "STYLE", "IFRAME", "TEXTAREA", "INPUT", "CANVAS", "VIDEO", "BUTTON", "SELECT", "OPTION", "NOSCRIPT", "PRE", "CODE", "SVG", "XMP", "TEMPLATE"];
    const _0x384037 = _0x366de4.join(",") + ", #maho-hidden-content";
    const _0x5ea96c = _0x53264d => {
      if (!_0x53264d) {
        return false;
      }
      if (_0x366de4.includes(_0x53264d.tagName)) {
        return true;
      }
      return _0x53264d.closest(_0x384037) !== null;
    };
    if (!_0xc4c5d0) {
      const _0x4f62db = _0x46c56a.dataset.mesid || _0x46c56a.getAttribute("mesid") || "";
      const _0x202dcb = _0x46c56a.dataset.timestamp || _0x46c56a.getAttribute("timestamp") || "";
      const _0x39e069 = _0x46c56a.dataset.chName || _0x46c56a.getAttribute("ch_name") || "";
      _0xc4c5d0 = _0x202dcb + "-" + _0x39e069 + "-" + _0x4f62db;
    }
    const _0x1e5031 = _0x53c720.textContent || "";
    const _0x3efe97 = _0x53c720.innerHTML || "";
    if (!_0x1e5031.includes(this._analysisBegins) && !_0x3efe97.includes(this._analysisBegins)) {
      return _0x4b33a5;
    }
    const _0x556463 = this._escapeRegex(this._analysisBegins);
    const _0x1abcef = this._escapeRegex(this._analysisCompleted);
    const _0x222dd5 = new RegExp(_0x556463 + "([\\s\\S]*?)" + _0x1abcef, "g");
    let _0x19bb5a = 0;
    const _0x541f04 = [];
    const _0x13ea96 = _0x53c720.ownerDocument || document;
    const _0x364b8c = _0x53c720.querySelectorAll(".tsp-image-slot[data-location-hash]");
    const _0x4c48ce = _0x53c720.querySelectorAll(".tsp-inline-gen-btn[data-location-hash]:not(.tsp-regenerate-btn)");
    _0x19bb5a = Math.max(_0x364b8c.length, _0x4c48ce.length);
    const _0x4230bf = _0x53c720.querySelectorAll("a");
    for (const _0x4ab881 of _0x4230bf) {
      if (_0x5ea96c(_0x4ab881)) {
        continue;
      }
      const _0x2f7db6 = _0x4ab881.textContent || "";
      if (!_0x2f7db6.includes(this._analysisBegins)) {
        continue;
      }
      if (_0x4ab881.dataset && _0x4ab881.dataset.tspProcessed === "true") {
        continue;
      }
      if (_0x4ab881.parentElement) {
        const _0x19d43c = _0x4ab881.parentElement.querySelector(".tsp-image-slot[data-location-hash]") || _0x4ab881.parentElement.querySelector(".tsp-generated-image[data-location-hash]");
        if (_0x19d43c) {
          _0x4ab881.dataset.tspProcessed = "true";
          continue;
        }
      }
      const _0xf8b5d2 = [..._0x2f7db6.matchAll(_0x222dd5)];
      if (_0xf8b5d2.length === 0) {
        continue;
      }
      const _0x32e6e5 = _0xf8b5d2.slice(-this._maxButtons);
      let _0x34c1bb = 0;
      const _0x16dfb2 = _0x2f7db6.replace(_0x222dd5, (_0x4a294c, _0x4838c7) => {
        if (_0x34c1bb >= _0x32e6e5.length) {
          return _0x4a294c;
        }
        const _0x7a82a6 = this._createStableLinkContent(_0x4838c7);
        const _0x93bd14 = this._md5(_0xc4c5d0 + "-" + _0x7a82a6 + "-" + _0x19bb5a);
        const _0x45e5ff = this._locationToImageIdMap[_0x93bd14];
        const _0xd9bb86 = {
          locationHash: _0x93bd14,
          cachedImageId: _0x45e5ff,
          link: _0x7a82a6,
          matchIndex: _0x19bb5a
        };
        _0x541f04.push(_0xd9bb86);
        _0x19bb5a++;
        _0x34c1bb++;
        return this._buildReplacementHtml(_0x93bd14, _0x45e5ff, _0x7a82a6, _0x19bb5a - 1);
      });
      if (_0x16dfb2 !== _0x2f7db6) {
        const _0x6258be = _0x13ea96.createElement("span");
        _0x6258be.innerHTML = _0x16dfb2;
        _0x6258be.dataset.tspProcessed = "true";
        addCopyToCodeBlocks(_0x6258be);
        if (_0x4ab881.parentNode) {
          _0x4ab881.parentNode.replaceChild(_0x6258be, _0x4ab881);
        }
      }
    }
    const _0xf667a3 = _0x53c720.querySelectorAll("image");
    for (const _0xeac04d of _0xf667a3) {
      if (_0x5ea96c(_0xeac04d)) {
        continue;
      }
      const _0x3aceb2 = _0xeac04d.textContent || "";
      if (!_0x3aceb2.includes(this._analysisBegins)) {
        continue;
      }
      if (_0xeac04d.dataset && _0xeac04d.dataset.tspProcessed === "true") {
        continue;
      }
      if (_0xeac04d.parentElement) {
        const _0x2d5d11 = _0xeac04d.parentElement.querySelector(".tsp-image-slot[data-location-hash]") || _0xeac04d.parentElement.querySelector(".tsp-generated-image[data-location-hash]");
        if (_0x2d5d11) {
          _0xeac04d.dataset.tspProcessed = "true";
          continue;
        }
      }
      const _0x4a4bfc = [..._0x3aceb2.matchAll(_0x222dd5)];
      if (_0x4a4bfc.length === 0) {
        continue;
      }
      const _0x316276 = _0x4a4bfc.slice(-this._maxButtons);
      let _0x2d7f8b = 0;
      const _0x45f5af = _0x3aceb2.replace(_0x222dd5, (_0x24798b, _0x4ba62f) => {
        if (_0x2d7f8b >= _0x316276.length) {
          return _0x24798b;
        }
        const _0x50aa95 = this._createStableLinkContent(_0x4ba62f);
        const _0x5455a0 = this._md5(_0xc4c5d0 + "-" + _0x50aa95 + "-" + _0x19bb5a);
        const _0x378780 = this._locationToImageIdMap[_0x5455a0];
        const _0x381bbd = {
          locationHash: _0x5455a0,
          cachedImageId: _0x378780,
          link: _0x50aa95,
          matchIndex: _0x19bb5a
        };
        _0x541f04.push(_0x381bbd);
        _0x19bb5a++;
        _0x2d7f8b++;
        return this._buildReplacementHtml(_0x5455a0, _0x378780, _0x50aa95, _0x19bb5a - 1);
      });
      if (_0x45f5af !== _0x3aceb2) {
        const _0x3636ba = _0x13ea96.createElement("span");
        _0x3636ba.innerHTML = _0x45f5af;
        _0x3636ba.dataset.tspProcessed = "true";
        addCopyToCodeBlocks(_0x3636ba);
        if (_0xeac04d.parentNode) {
          _0xeac04d.parentNode.replaceChild(_0x3636ba, _0xeac04d);
        }
      }
    }
    const _0x2c6993 = _0x53c720.querySelectorAll(".log-entry");
    for (const _0x3ee35e of _0x2c6993) {
      const _0x47f19a = _0x3ee35e;
      const _0x34d947 = _0x47f19a.innerHTML;
      const _0x2f54fc = this._simpleHash(_0x34d947.substring(0, 500));
      const _0x580693 = _0x47f19a.dataset.tspContentHash || "";
      if (_0x47f19a.dataset.tspLogProcessed === "true" && _0x2f54fc === _0x580693) {
        continue;
      }
      if (!_0x34d947.includes(this._analysisBegins)) {
        continue;
      }
      const _0x32d86f = _0x47f19a.querySelector(".tsp-image-slot[data-location-hash]") || _0x47f19a.querySelector(".tsp-generated-image[data-location-hash]");
      if (_0x32d86f && _0x47f19a.dataset.tspLogProcessed === "true") {
        _0x47f19a.dataset.tspContentHash = _0x2f54fc;
        continue;
      }
      const _0x3dcdcd = _0x34d947.match(_0x222dd5) || [];
      if (_0x3dcdcd.length === 0) {
        continue;
      }
      const _0x4ef509 = _0x3dcdcd.slice(-this._maxButtons);
      let _0x30839e = 0;
      _0x222dd5.lastIndex = 0;
      const _0x3abf63 = _0x34d947.replace(_0x222dd5, (_0x33be52, _0x529fd3) => {
        if (_0x30839e >= _0x4ef509.length) {
          return _0x33be52;
        }
        const _0x2adeaa = this._createStableLinkContent(_0x529fd3);
        const _0x1c7d03 = this._md5(_0xc4c5d0 + "-" + _0x2adeaa + "-" + _0x19bb5a);
        const _0x153399 = this._locationToImageIdMap[_0x1c7d03];
        const _0x397aec = {
          locationHash: _0x1c7d03,
          cachedImageId: _0x153399,
          link: _0x2adeaa,
          matchIndex: _0x19bb5a
        };
        _0x541f04.push(_0x397aec);
        _0x19bb5a++;
        _0x30839e++;
        return this._buildReplacementHtml(_0x1c7d03, _0x153399, _0x2adeaa, _0x19bb5a - 1);
      });
      if (_0x3abf63 !== _0x34d947) {
        _0x47f19a.innerHTML = _0x3abf63;
        addCopyToCodeBlocks(_0x47f19a);
        _0x47f19a.dataset.tspLogProcessed = "true";
        _0x47f19a.dataset.tspContentHash = _0x2f54fc;
      }
    }
    if (_0x2c6993.length === 0) {
      let _0x16bba2 = [];
      try {
        const _0x30d35d = _0x13ea96.createTreeWalker(_0x53c720, NodeFilter.SHOW_TEXT, {
          acceptNode: _0x3ce5bc => {
            if (_0x3ce5bc.parentElement && _0x366de4.includes(_0x3ce5bc.parentElement.tagName)) {
              return NodeFilter.FILTER_REJECT;
            }
            if (_0x3ce5bc.parentElement && _0x3ce5bc.parentElement.closest(_0x384037)) {
              return NodeFilter.FILTER_REJECT;
            }
            const _0x231899 = _0x3ce5bc.textContent || "";
            if (_0x231899.includes(this._analysisBegins)) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_SKIP;
          }
        });
        let _0x29c22c;
        while (_0x29c22c = _0x30d35d.nextNode()) {
          _0x16bba2.push(_0x29c22c);
        }
      } catch (_0x202ed0) {
        this.ctx.warn("image-gen", "TreeWalker 失败:", _0x202ed0.message);
      }
      for (const _0x20c700 of _0x16bba2) {
        const _0x221148 = _0x20c700.textContent || "";
        if (!_0x221148.includes(this._analysisBegins)) {
          continue;
        }
        const _0x249d51 = _0x20c700.parentElement;
        if (_0x249d51 && _0x249d51.dataset && _0x249d51.dataset.tspTextProcessed === "true") {
          continue;
        }
        if (_0x249d51) {
          const _0x81d4f1 = _0x249d51.querySelector(".tsp-image-slot[data-location-hash]") || _0x249d51.querySelector(".tsp-generated-image[data-location-hash]");
          if (_0x81d4f1 && _0x249d51.dataset.tspTextProcessed === "true") {
            _0x249d51.dataset.tspTextProcessed = "true";
            continue;
          }
        }
        const _0x159c02 = [..._0x221148.matchAll(_0x222dd5)];
        if (_0x159c02.length === 0) {
          continue;
        }
        const _0x2543d4 = _0x159c02.slice(-this._maxButtons);
        let _0x10ab5c = 0;
        const _0x1cc00f = _0x13ea96.createElement("div");
        _0x222dd5.lastIndex = 0;
        const _0x347d66 = _0x221148.replace(_0x222dd5, (_0x179e9c, _0x1e29f2) => {
          if (_0x10ab5c >= _0x2543d4.length) {
            return _0x179e9c;
          }
          const _0x382abb = this._createStableLinkContent(_0x1e29f2);
          const _0x225407 = this._md5(_0xc4c5d0 + "-" + _0x382abb + "-" + _0x19bb5a);
          const _0x49819f = this._locationToImageIdMap[_0x225407];
          const _0x5d3f58 = {
            locationHash: _0x225407,
            cachedImageId: _0x49819f,
            link: _0x382abb,
            matchIndex: _0x19bb5a
          };
          _0x541f04.push(_0x5d3f58);
          _0x19bb5a++;
          _0x10ab5c++;
          return this._buildReplacementHtml(_0x225407, _0x49819f, _0x382abb, _0x19bb5a - 1);
        });
        if (_0x347d66 !== _0x221148) {
          _0x1cc00f.innerHTML = _0x347d66;
          addCopyToCodeBlocks(_0x1cc00f);
          const _0x3e700f = _0x13ea96.createDocumentFragment();
          while (_0x1cc00f.firstChild) {
            _0x3e700f.appendChild(_0x1cc00f.firstChild);
          }
          if (_0x20c700.parentNode) {
            _0x20c700.parentNode.replaceChild(_0x3e700f, _0x20c700);
            if (_0x249d51) {
              _0x249d51.dataset.tspTextProcessed = "true";
            }
          }
        }
      }
    }
    if (_0x2c6993.length === 0 && _0x3efe97.includes(this._analysisBegins) && _0x3efe97.includes(this._analysisCompleted)) {
      let _0x447568 = true;
      let _0x577949 = 0;
      while (_0x447568 && _0x577949 < 10) {
        _0x577949++;
        _0x447568 = false;
        const _0x44c03a = _0x13ea96.createTreeWalker(_0x53c720, NodeFilter.SHOW_TEXT, null, false);
        const _0x2e0ba5 = [];
        let _0x4237d2;
        while (_0x4237d2 = _0x44c03a.nextNode()) {
          _0x2e0ba5.push(_0x4237d2);
        }
        let _0x3d31a7 = -1;
        let _0x6cf648 = -1;
        let _0x355056 = -1;
        let _0x12b3af = -1;
        for (let _0x39b569 = 0; _0x39b569 < _0x2e0ba5.length; _0x39b569++) {
          const _0x2ce9aa = _0x2e0ba5[_0x39b569].textContent || "";
          if (_0x3d31a7 === -1) {
            const _0xf8a988 = _0x2ce9aa.indexOf(this._analysisBegins);
            if (_0xf8a988 !== -1) {
              if (_0x5ea96c(_0x2e0ba5[_0x39b569].parentElement)) {
                continue;
              }
              _0x3d31a7 = _0x39b569;
              _0x6cf648 = _0xf8a988;
            }
          }
          if (_0x3d31a7 !== -1) {
            const _0x3c1300 = _0x3d31a7 === _0x39b569 ? _0x6cf648 + this._analysisBegins.length : 0;
            const _0x418343 = _0x2ce9aa.indexOf(this._analysisCompleted, _0x3c1300);
            if (_0x418343 !== -1) {
              _0x355056 = _0x39b569;
              _0x12b3af = _0x418343 + this._analysisCompleted.length;
              break;
            }
          }
        }
        if (_0x3d31a7 !== -1 && _0x355056 !== -1) {
          _0x447568 = true;
          const _0x1c20ac = _0x13ea96.createRange();
          try {
            _0x1c20ac.setStart(_0x2e0ba5[_0x3d31a7], _0x6cf648);
            _0x1c20ac.setEnd(_0x2e0ba5[_0x355056], _0x12b3af);
            const _0xd1bbcc = _0x1c20ac.cloneContents();
            const _0x451716 = _0x13ea96.createElement("div");
            _0x451716.appendChild(_0xd1bbcc);
            let _0x1f8fd0 = _0x451716.innerHTML;
            _0x1f8fd0 = _0x1f8fd0.replace(this._analysisBegins, "").replace(this._analysisCompleted, "");
            const _0x5e90be = this._createStableLinkContent(_0x1f8fd0);
            const _0x2d5081 = this._md5(_0xc4c5d0 + "-" + _0x5e90be + "-" + _0x19bb5a);
            const _0x410b04 = this._locationToImageIdMap[_0x2d5081];
            const _0x355794 = {
              locationHash: _0x2d5081,
              cachedImageId: _0x410b04,
              link: _0x5e90be,
              matchIndex: _0x19bb5a
            };
            _0x541f04.push(_0x355794);
            const _0x3cd2ba = this._buildReplacementHtml(_0x2d5081, _0x410b04, _0x5e90be, _0x19bb5a);
            _0x19bb5a++;
            const _0x33f89e = _0x13ea96.createElement("div");
            _0x33f89e.innerHTML = _0x3cd2ba;
            const _0x5c8837 = _0x13ea96.createDocumentFragment();
            while (_0x33f89e.firstChild) {
              _0x5c8837.appendChild(_0x33f89e.firstChild);
            }
            _0x1c20ac.deleteContents();
            _0x1c20ac.insertNode(_0x5c8837);
          } catch (_0x9de7bf) {
            this.ctx.warn("image-gen", "Strategy 6 DOM切割失败(DOM可能畸形):", _0x9de7bf);
            break;
          }
        }
      }
    }
    if (_0x2c6993.length === 0 && _0x3efe97.includes(this._analysisBegins)) {
      const _0x4871b1 = this._findSmallestElementsWithTags(_0x53c720, this._analysisBegins);
      for (const _0x2e2f8f of _0x4871b1) {
        if (_0x5ea96c(_0x2e2f8f)) {
          continue;
        }
        if (_0x2e2f8f.dataset && _0x2e2f8f.dataset.tspElementProcessed === "true") {
          continue;
        }
        const _0x2b233b = _0x2e2f8f.innerHTML;
        if (!_0x2b233b.includes(this._analysisBegins)) {
          continue;
        }
        const _0x134227 = _0x2e2f8f.querySelector(".tsp-image-slot[data-location-hash]") || _0x2e2f8f.querySelector(".tsp-generated-image[data-location-hash]");
        if (_0x134227 && _0x2e2f8f.dataset.tspElementProcessed === "true") {
          _0x2e2f8f.dataset.tspElementProcessed = "true";
          continue;
        }
        const _0x2cf6eb = [..._0x2b233b.matchAll(_0x222dd5)];
        if (_0x2cf6eb.length === 0) {
          continue;
        }
        const _0x1193bc = _0x2cf6eb.slice(-this._maxButtons);
        let _0x25a9f4 = 0;
        _0x222dd5.lastIndex = 0;
        const _0xc8e3d4 = _0x2b233b.replace(_0x222dd5, (_0x3d8c7c, _0x5464ab) => {
          if (_0x25a9f4 >= _0x1193bc.length) {
            return _0x3d8c7c;
          }
          const _0x564e3e = this._createStableLinkContent(_0x5464ab);
          const _0x32ad22 = this._md5(_0xc4c5d0 + "-" + _0x564e3e + "-" + _0x19bb5a);
          const _0x202abf = this._locationToImageIdMap[_0x32ad22];
          const _0x163a97 = {
            locationHash: _0x32ad22,
            cachedImageId: _0x202abf,
            link: _0x564e3e,
            matchIndex: _0x19bb5a
          };
          _0x541f04.push(_0x163a97);
          _0x19bb5a++;
          _0x25a9f4++;
          return this._buildReplacementHtml(_0x32ad22, _0x202abf, _0x564e3e, _0x19bb5a - 1);
        });
        if (_0xc8e3d4 !== _0x2b233b) {
          _0x2e2f8f.innerHTML = _0xc8e3d4;
          addCopyToCodeBlocks(_0x2e2f8f);
          _0x2e2f8f.dataset.tspElementProcessed = "true";
        }
      }
    }
    if (_0x541f04.length > 0) {
      const _0x417875 = _0x53c720.querySelectorAll(".tsp-inline-gen-btn");
      _0x417875.forEach(_0x4b70d5 => {
        const _0x2f9334 = _0x4b70d5;
        if (!_0x2f9334.dataset.bound) {
          _0x2f9334.dataset.bound = "true";
          _0x2f9334.addEventListener("click", _0x4536f4 => this._handleInlineButtonClick(_0x4536f4, _0x2f9334, _0x46c56a));
          _0x4b33a5.push(_0x2f9334);
        }
      });
      _0x541f04.forEach(_0x3d657a => {
        if (_0x3d657a.cachedImageId && _0x3d657a.cachedImageId !== "processing") {
          this._loadCachedImageForSlot(_0x3d657a.locationHash, _0x3d657a.cachedImageId);
        }
      });
    }
    return _0x4b33a5;
  }
  _buildReplacementHtml(_0x585500, _0x56d5fb, _0x382707, _0x14b9a6) {
    let _0x247be6 = "";
    if (_0x56d5fb && _0x56d5fb !== "processing") {
      _0x247be6 = "<span class=\"tsp-image-slot\" data-location-hash=\"" + _0x585500 + "\" data-image-id=\"" + _0x56d5fb + "\">\n                <button class=\"tsp-inline-gen-btn tsp-regenerate-btn\"\n                        data-link=\"" + this._escapeHtml(_0x382707) + "\"\n                        data-location-hash=\"" + _0x585500 + "\"\n                        data-match-index=\"" + _0x14b9a6 + "\"\n                        title=\"点击重新生成\">\n                    生成图片\n                </button>\n                <img class=\"tsp-generated-image tsp-inline-image\"\n                     src=\"" + TRANSPARENT_PIXEL + "\"\n                     data-is-loaded=\"false\"\n                     data-image-id=\"" + _0x56d5fb + "\"\n                     data-location-hash=\"" + _0x585500 + "\"\n                     alt=\"图片占位符\"\n                     style=\"max-width:100%; cursor:pointer; border-radius:8px; min-height: 50px; background: rgba(122,162,247,0.1);\">\n            </span>";
    } else {
      _0x247be6 = "<button class=\"tsp-inline-gen-btn\" data-link=\"" + this._escapeHtml(_0x382707) + "\" data-location-hash=\"" + _0x585500 + "\" data-match-index=\"" + _0x14b9a6 + "\" title=\"点击生成图片\">\n                <i class=\"fa-solid fa-image\"></i> 生成图片\n            </button>";
    }
    if (!this._privacyMode) {
      return _0x247be6;
    }
    const _0x54505f = this._zoomRatio || 100;
    return "\n        <div class=\"tsp-privacy-container\" style=\"max-width: " + _0x54505f + "%;\">\n            <div class=\"tsp-privacy-toggle\" onclick=\"this.parentElement.classList.toggle('expanded')\">\n                <i class=\"fa-solid fa-eye-slash\"></i> <span>已加密内容 (点击解码)</span>\n                <i class=\"fa-solid fa-chevron-down tsp-chevron\"></i>\n            </div>\n            <div class=\"tsp-privacy-content\">\n                " + _0x247be6 + "\n            </div>\n        </div>";
  }
  _findSmallestElementsWithTags(_0x348967, _0x30956e) {
    const _0x21a842 = [];
    const _0x56a94a = _0xcfceb9 => {
      const _0x57ee68 = _0xcfceb9.innerHTML || "";
      const _0x3441be = _0xcfceb9.textContent || "";
      if (!_0x57ee68.includes(_0x30956e) && !_0x3441be.includes(_0x30956e)) {
        return;
      }
      let _0x2081be = false;
      const _0x10ac17 = _0xcfceb9.children;
      for (let _0x303c1f = 0; _0x303c1f < _0x10ac17.length; _0x303c1f++) {
        const _0x256e10 = _0x10ac17[_0x303c1f];
        const _0x2eb172 = _0x256e10.innerHTML || "";
        const _0x2d6af4 = _0x256e10.textContent || "";
        if (_0x2eb172.includes(_0x30956e) || _0x2d6af4.includes(_0x30956e)) {
          _0x2081be = true;
          _0x56a94a(_0x256e10);
        }
      }
      if (!_0x2081be && (_0x57ee68.includes(_0x30956e) || _0x3441be.includes(_0x30956e))) {
        if (_0xcfceb9.tagName !== "BODY" && _0xcfceb9.tagName !== "HTML") {
          _0x21a842.push(_0xcfceb9);
        } else {
          for (let _0x38a25c = 0; _0x38a25c < _0x10ac17.length; _0x38a25c++) {
            const _0x389f33 = _0x10ac17[_0x38a25c];
            const _0x5e9f3f = _0x389f33.innerHTML || "";
            const _0x1dd5d3 = _0x389f33.textContent || "";
            if (_0x5e9f3f.includes(_0x30956e) || _0x1dd5d3.includes(_0x30956e)) {
              _0x21a842.push(_0x389f33);
            }
          }
        }
      }
    };
    _0x56a94a(_0x348967);
    return _0x21a842;
  }
}