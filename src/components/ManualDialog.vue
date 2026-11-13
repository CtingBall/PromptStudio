<script setup lang="ts">
// Beginner manual. Never forced: the app only shows a one-time hint bar on first launch.
import { ref } from 'vue'
const emit = defineEmits<{ (e: 'close'): void }>()
const TABS = [
  { id: 'start', label: '快速上手' },
  { id: 'format', label: '三种写法' },
  { id: 'features', label: '功能一览' },
  { id: 'ai', label: 'AI 与模型' },
  { id: 'data', label: '数据与更新' },
] as const
const tab = ref<(typeof TABS)[number]['id']>('start')
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal manual">
      <div class="row">
        <h3 style="margin: 0">📖 千夏绘卷 · 新手手册</h3>
        <span class="spacer" />
        <button class="ghost" @click="emit('close')">关闭</button>
      </div>
      <div class="btn-group" style="margin: 10px 0">
        <button v-for="t in TABS" :key="t.id" :class="{ on: tab === t.id }" @click="tab = t.id">{{ t.label }}</button>
      </div>

      <div class="manual-body">
        <template v-if="tab === 'start'">
          <h4>三步开始</h4>
          <ol>
            <li><b>接上 AI</b>：点右上角 ⚙️，填 API 地址、Key 和模型（OpenAI 兼容接口都行，官方或中转站），点「测试连接」。不接 AI 也能用，只是不能自动翻译和生成。</li>
            <li><b>生成第一组</b>：点「✨ 一键生成」，写一句主题，比如「雨夜霓虹街头撑红伞的少女」，选写法，点生成。</li>
            <li><b>整理和使用</b>：在标签区拖动、改权重、改译文；点「复制」贴到 WebUI / ComfyUI，或直接导出 ComfyUI 工作流。出图后把图拖进右侧「返图」，以后一眼就知道这组提示词出什么效果。</li>
          </ol>
          <h4>常用操作</h4>
          <ul>
            <li>双击标签的英文或中文可以直接改；鼠标移上去有 ＋/− 调权重和 × 删除。</li>
            <li>「批量」模式下按住左键拖过去可以连选，左侧列表、标签、导入导出、分享列表都支持。</li>
            <li>AI 改坏了？点「↶ 撤销」，或用「🕘 历史」回到更早的版本。</li>
          </ul>
        </template>

        <template v-else-if="tab === 'format'">
          <p>一键生成时可以选三种写法。选哪种主要看你用的画图模型的<b>文本编码器</b>：老的 CLIP 编码器认标签，新的大语言模型编码器读得懂句子。</p>
          <table>
            <tr><th style="width: 14%">写法</th><th>优势</th><th>缺点</th><th style="width: 24%">适合</th></tr>
            <tr><td><b>标签</b><br /><code>1girl, red umbrella, rain, neon lights</code></td>
              <td>模型训练时就是这样标的，词义稳定、好控制；改一个词只影响一处；加权 <code>(tag:1.3)</code> 直接有效；短，不容易超长。</td>
              <td>很难表达关系和位置（谁拿着什么、谁在谁左边）；多人物时属性容易串（A 的衣服跑到 B 身上）；词一多画面变「拼贴」。</td>
              <td>SD1.5 / SDXL / Pony / Illustrious / NoobAI / NovelAI / Anima 等二次元模型</td></tr>
            <tr><td><b>自然语言</b><br /><code>A girl holds a red umbrella in the rain…</code></td>
              <td>能写清动作、关系、位置和多人物分别的样子；画面更像一个完整场景；配合画框布局效果最好。</td>
              <td>对老模型基本无效甚至更差；同一句话换个说法效果会变，不如标签好微调；加权语法多半不起作用；更长，翻译和编辑更费事。</td>
              <td>MOSS-Image、Flux、Qwen-Image、SD3、HiDream 等以大语言模型/T5 做编码器的模型</td></tr>
            <tr><td><b>标签+自然语言</b></td>
              <td>标签保证关键元素（角色触发词、服装、画风）一定出现，句子补上关系和动作；对新旧模型都不会太差。</td>
              <td>最长；两部分写得矛盾时模型会混乱；在纯标签模型上句子部分多半被忽略，等于白写。</td>
              <td>同时训练过两种标注的模型（如 MOSS 的 tags+NL、部分 Illustrious 微调），或不确定时的折中</td></tr>
            <tr><td><b>GBC 图结构</b><br /><code>&lt;gbc …&gt; # [image] … - [girl] [y1,x1,y2,x2] …</code></td>
              <td>来自 KohakuGBC：一句整图描述 + 标签 + 每个物体/人物一行（带坐标和单独描述），多人物、多物体时属性最不容易串，位置最准。选它会自动生成画框。</td>
              <td>只有专门用 GBC 标注训练过的模型认得（如 MOSS-Image-heal）；其他模型会把坐标当成乱码；最长，框要摆得合理。</td>
              <td>MOSS-Image-heal 等 KohakuGBC 训练的模型。生成后点画框区的「复制 GBC」拿到成品</td></tr>
          </table>
          <h4>怎么选</h4>
          <ul>
            <li>用二次元 SDXL 系、带角色 LoRA 出图：<b>标签</b>。</li>
            <li>用 MOSS 画漫画分镜、多人互动、带对话气泡：<b>自然语言</b>，配合画框布局。</li>
            <li>拿不准：先用<b>标签+自然语言</b>出一张，再对比另外两种。</li>
            <li>角色 LoRA 的外貌（发色、瞳色、耳朵）不要写进提示词，交给触发词，生成窗口里那个勾默认已帮你过滤。</li>
          </ul>
        </template>

        <template v-else-if="tab === 'features'">
          <table>
            <tr><th style="width: 22%">功能</th><th>说明</th></tr>
            <tr><td>✨ 一键生成</td><td>三种模式：写主题生成、把乱糟糟的原始提示词整理成分段结构、按你画的框生成。可以带参考图，可选同时生成画框布局。</td></tr>
            <tr><td>分段结构</td><td>提示词按 镜头 / 角色 / 表情 / 动作 / 服装 / 场景 / 光影 / 画风 分段，可以折叠、拖动排序、跨段拖标签。</td></tr>
            <tr><td>画框布局</td><td>在画布上画框，给每个框写内容（物体、角色、对话），可导出成 ComfyUI 官方 Create Bounding Boxes + MOSS 布局节点能用的格式，或「复制 MOSS JSON」。</td></tr>
            <tr><td>AI 工具（右侧）</td><td>按一句话修改、快捷修改、生成变体、自动整理（分级/文件夹/标签/起名）、诊断提示词、对照返图检查、从返图反推提示词。</td></tr>
            <tr><td>返图</td><td>把出的图拖进来存档；带生成参数的 PNG 可以直接读出提示词新建一组。</td></tr>
            <tr><td>分级与整理</td><td>全年龄 / 16+ / 18+ 分级、文件夹、自由标签、收藏、搜索和排序；批量改、批量合并、批量删。</td></tr>
            <tr><td>🕘 历史</td><td>AI 修改和批量操作前自动保存，最多 15 个版本，可以看差异、一键回退。</td></tr>
            <tr><td>导入 / 导出 / 🔗 分享</td><td>导出 JSON（可带图）给自己备份；分享码或 Gist 链接发给别人，不含图片和 Key。</td></tr>
          </table>
        </template>

        <template v-else-if="tab === 'ai'">
          <h4>主 AI 与各功能模型</h4>
          <p>设置里填的是<b>主 AI</b>，所有功能默认都用它。点「各功能单独设置模型（详情）」可以给某个功能换模型，只填想改的格子，空着的自动沿用主 AI。</p>
          <ul>
            <li><b>翻译</b>：量大、要求低，换便宜快速的模型能省很多钱。</li>
            <li><b>一键生成 / 反推</b>：最吃水平，用你手上最强的；要传参考图或反推，必须选能看图的模型。</li>
            <li><b>诊断 / 返图检查</b>：返图检查需要看图。</li>
            <li>每一行都有「测试」按钮，可以单独测这个功能的连接。</li>
          </ul>
          <h4>生成窗口里的选项</h4>
          <ul>
            <li><b>创意度</b>：越高越放飞，越低越贴近你写的内容。整理原始提示词建议低一点。</li>
            <li><b>注入设置</b>：质量词前缀、默认负向词、附加规则（例如「必须 cowboy shot」），每次生成都会带上。</li>
            <li><b>画面角色</b>：一行一个「名字=触发词 | 引导词 | 默认服装」，用于角色 LoRA 和多人画框。</li>
          </ul>
          <p class="muted">Key 只存在你自己电脑上，导出和分享都不会带出去。</p>
        </template>

        <template v-else>
          <ul>
            <li>数据存在本机，桌面版更新不会丢失。</li>
            <li>想换电脑或备份：设置 → 「备份全部数据」，或「导出」时选全部。</li>
            <li>桌面版会自动检查更新，下载好后提示你重启安装。</li>
            <li>彩蛋：在设置里的版本号上快速点几下试试。</li>
          </ul>
        </template>
      </div>
    </div>
  </div>
</template>
