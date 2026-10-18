import type { Locale } from '../../i18n'
import type { NoteInput } from '../model'

interface Entry {
  front: string
  back: string
  type?: 'basic' | 'reversed' | 'cloze'
  topic: 'fsrs' | 'repeaty'
  format?: NoteInput['format']
  media?: 'curve' | 'tones'
}
const fsrs = 'https://github.com/open-spaced-repetition/awesome-fsrs/wiki/ABC-of-FSRS'
const ratings = 'https://docs.ankiweb.net/manual/studying#answer-buttons'
const options = 'https://docs.ankiweb.net/manual/deck-options#desired-retention'

// Card text is saved in the language chosen at creation, just like user-authored notes.
export const content: Record<Locale, { name: string; description: string; entries: Entry[] }> = {
  'zh-CN': {
    name: '从这里开始：FSRS 与 Repeaty',
    description: '先试着回答，再翻面核对。24 条笔记，学习 FSRS、评分与制卡；也可以随时编辑或删除。',
    entries: [
      {
        topic: 'repeaty',
        front: '看到问题后，翻面之前先做什么？',
        back: '**试着说出答案。** 然后点「显示答案」，对照自己的回答评分。\n\n第一次遇到陌生知识，选「重来」很正常。这组卡片既是教程，也可以像自己的卡片一样编辑、暂停或删除。\n\n键盘：空格翻面，显示答案后按 1 / 2 / 3 / 4 评分。',
      },
      {
        topic: 'fsrs',
        front: 'FSRS 在 Repeaty 中负责决定什么？',
        back: '**下一次什么时候复习这张卡片。**\n\nFSRS（Free Spaced Repetition Scheduler）根据每次评分和实际间隔更新记忆状态，再安排下次复习。卡片的内容仍由你决定。\n\n[FSRS 原理](https://github.com/open-spaced-repetition/awesome-fsrs/wiki/ABC-of-FSRS)',
      },
      {
        topic: 'fsrs',
        front: '翻面前完全想不起来，看到答案后觉得很熟悉。应该选「重来」还是「困难」？',
        back:
          '**重来。** 认得答案，不等于刚才能回想起来。\n\n| 评分 | 翻面前的表现 |\n| --- | --- |\n| 重来 · 1 | 忘了或答错 |\n| 困难 · 2 | 答对了，但很费力 |\n| 良好 · 3 | 正常答对 |\n| 简单 · 4 | 很轻松就答对 |\n\n按刚才的表现选，不要为了更长的间隔选「简单」。[评分说明](' +
          ratings +
          ')',
      },
      {
        topic: 'repeaty',
        type: 'reversed',
        format: 'plain',
        front: '主动回忆',
        back: 'Active recall',
      },
      {
        topic: 'repeaty',
        front: '刚才的「主动回忆 ↔ Active recall」为什么会生成两张卡片？',
        back: '它是一条**双向笔记**：两个方向分别提问、分别记录复习进度。\n\n在「添加卡片」中选择「双向卡」即可创建。默认评分后会把同笔记的另一张卡暂缓到明天，避免答案互相提示；可以在卡组设置中关闭。',
      },
      {
        topic: 'fsrs',
        type: 'cloze',
        front:
          '目标记忆保留率为 90%，表示希望在下次复习时，有约 {{c1::90%::概率}} 的机会想起答案。',
        back:
          '这是模型的目标概率，不是保证记住整副卡组的 90%。\n\n这是一张**挖空卡**：编辑时写 `{{c1::90%::概率}}`，答题时只显示提示。[目标记忆保留率](' +
          options +
          ')',
      },
      {
        topic: 'fsrs',
        front: '把目标记忆保留率从 90% 调高，通常会怎样？',
        back:
          '**复习更频繁，工作量增加。**\n\n在卡组设置里调整。可以先用默认的 90%，观察每天是否做得完，再决定是否修改。[Anki 说明](' +
          options +
          ')',
      },
      {
        topic: 'fsrs',
        front: 'FSRS 中的 R（可提取性）表示什么？',
        back:
          '**此刻能想起这条信息的概率。**\n\n没有复习时，R 会随时间下降。它是估计值，FSRS 不能直接读取你的记忆。[记忆状态](' +
          fsrs +
          ')',
      },
      {
        topic: 'fsrs',
        front: '一张卡片的稳定性 S = 10 天，意味着什么？',
        back:
          '模型估计，经过 10 天后，回想概率降到 90%。\n\n$$S = 10\\text{ 天} \\quad \\Rightarrow \\quad R(10) = 0.9$$\n\n这展示了数学公式：编辑时用 `$...$` 写行内公式、`$$...$$` 写独立公式。实际到期时间还受目标保留率和学习步骤等设置影响。[稳定性定义](' +
          fsrs +
          ')',
      },
      {
        topic: 'fsrs',
        media: 'curve',
        front: '图中 A、B 两条曲线，哪一条对应更稳定的记忆？',
        back: '**B。** 它下降得更慢，也更晚到达 90% 的虚线。\n\n图中曲线仅用于解释稳定性，不是实际 FSRS 公式，也不是你的个人预测。可以在卡片正面、背面添加图片，或直接粘贴图片。',
      },
      {
        topic: 'fsrs',
        front: 'FSRS 中的难度 D，与按钮「困难」是同一回事吗？',
        back:
          '**不是。** D 是每张卡片的模型状态，影响稳定性在复习后增长的速度；「困难」是你对这一次回想表现的评分。\n\n评分会影响模型更新，但不应为了指定某个 D 值而选择按钮。[难度定义](' +
          fsrs +
          ')',
      },
      {
        topic: 'fsrs',
        front: '漏学了几天，需要把所有卡片重置为新卡吗？',
        back: '**不需要，继续复习并如实评分。** FSRS 会考虑实际经过的时间。\n\nRepeaty 使用 ts-fsrs 的默认参数，并随复习更新各张卡片的状态；目前不支持用个人历史训练参数。',
      },
      {
        topic: 'repeaty',
        type: 'cloze',
        front:
          '同一段文字中，{{c1::相同编号}} 的挖空一起隐藏，{{c2::不同编号}} 的挖空分别生成卡片。',
        back: '这条笔记生成两张卡片。\n\n```text\n{{c1::相同编号}} … {{c2::不同编号}}\n```\n\n把几个答案都写成 `c1`，它们就会在同一张卡里一起隐藏。不要嵌套挖空。',
      },
      {
        topic: 'repeaty',
        front:
          '下面这段 Python 的输出是什么？\n\n```python\nintervals = [1, 3, 7]\nprint(sum(intervals))\n```',
        back: '**11**。\n\n这是代码块的示例，不是 FSRS 算法。在编辑器里选择「Markdown / 数学公式」，用三枚反引号包住代码；还可以使用列表、表格和链接。',
      },
      {
        topic: 'repeaty',
        media: 'tones',
        front: '播放下面的两个音，第二个音比第一个更高还是更低？',
        back: '**更高。** 第一个是 440 Hz，第二个是 880 Hz。\n\n这是 Repeaty 自制的音频示例。单词发音、听辨练习也可以使用附件；正面和背面都能放音频。不方便听时，直接翻面或暂缓这张卡即可。',
      },
      {
        topic: 'repeaty',
        front: '怎样只找出这组卡片中讲 FSRS 的题目？',
        back: '打开「全部卡片」，搜索 `tag:fsrs`。\n\n本卡组使用 `starter`、`fsrs`、`repeaty` 标签。还可以搜索 `type:cloze` 找挖空卡，或用 `tag:fsrs is:new` 组合条件。常用的条件可以保存为筛选。',
      },
      {
        topic: 'repeaty',
        front: '想把这组卡片快速看一遍，又不改下次复习时间，应该用什么模式？',
        back: '在卡片列表展开「高级搜索、常用筛选与专项练习」，选择**只练习，不改进度**。\n\n练习当前筛选结果，按提示翻面和评分；结束后原来的复习安排不变。',
      },
      {
        topic: 'repeaty',
        front: '刚才误点了评分，怎么改回来？',
        back: '点击**撤销上次评分**，再重新回答。\n\n撤销会恢复上次评分前的进度，也会恢复这次评分引起的同笔记卡片暂缓状态。',
      },
      {
        topic: 'repeaty',
        type: 'cloze',
        front:
          '今天不想复习某张卡，可选「{{c1::今天暂缓}}」；想停用直到手动恢复，可选「{{c2::暂停此卡}}」。',
        back: '暂缓会在第二天解除；暂停需要在卡片列表中手动恢复。\n\n两种操作都保留卡片内容和学习记录，不等于删除。',
      },
      {
        topic: 'repeaty',
        front: '明明还有新卡，为什么今天不再出现了？',
        back: '可能已经达到**每日新卡上限**，或它们是今天已暂缓的同笔记卡片。\n\n可以在卡组设置中检查每日新卡、到期复习上限和同笔记暂缓。入门卡组的新卡上限为 30；其他新建卡组默认是 20。',
      },
      {
        topic: 'repeaty',
        front: '一道题总是忘记，除了反复点「重来」，还可以做什么？',
        back: '**把题目改小、改清楚。**\n\n例如，把「解释 FSRS 的所有原理」拆成「R 表示什么」「S 的单位是什么」等问题。可以从卡片列表进入编辑；频繁遗忘的卡片会被标记为顽固卡，方便集中修改。',
      },
      {
        topic: 'repeaty',
        front: '换浏览器或清理网站数据前，怎样保留卡片、图片和音频？',
        back: '在「数据与备份」中**导出 .repeaty**，把文件留在网站之外。恢复备份会替换目标学习库，操作前会要求确认。\n\n纯前端版的数据只在当前浏览器；后端版的数据在服务的 SQLite 中。两版可通过备份迁移。自动快照不能替代独立备份。',
      },
      {
        topic: 'repeaty',
        front: '插件在哪里安装？在线版能直接使用 LeetCode 判题吗？',
        back: '插件由**部署者**安装，再由使用者在「插件」页开启或关闭。关闭不会删除已有题目和进度。\n\n纯前端插件只在浏览器运行；需要服务的插件用于后端版。GitHub Pages 在线版不包含 LeetCode。后端版内置 LeetCode，但部署者仍需配置连接。',
      },
      {
        topic: 'repeaty',
        front: '学完入门卡组后，怎样开始自己的第一组卡片？',
        back:
          '点击「创建卡组」→「添加卡片」，先写一个明确的问题和简短答案。已有表格可以从 CSV / TSV 导入。\n\n这组入门卡可以保留、修改或删除；删除后不会自动回来。「数据与备份」中可以再次添加，使用当时的界面语言。\n\n继续阅读：[FSRS 原理](' +
          fsrs +
          ') · [Anki 的评分说明](' +
          ratings +
          ')。',
      },
    ],
  },
  en: {
    name: 'Start here: FSRS & Repeaty',
    description:
      'Try an answer, then turn the card over. 24 notes on FSRS, ratings and making cards. Edit or delete them whenever you like.',
    entries: [
      {
        topic: 'repeaty',
        front: 'What should you do before turning a card over?',
        back: '**Try to answer from memory.** Then select “Show answer” and rate what you recalled.\n\nIf the material is new, choosing Again is normal. These tutorial cards can be edited, suspended or deleted just like your own.\n\nKeyboard: Space reveals the answer; 1 / 2 / 3 / 4 rate it after revealing.',
      },
      {
        topic: 'fsrs',
        front: 'What does FSRS decide in Repeaty?',
        back:
          '**When to review a card next.**\n\nFSRS (Free Spaced Repetition Scheduler) updates its estimate of your memory from each rating and the time between reviews. You decide what goes on the cards.\n\n[How FSRS works](' +
          fsrs +
          ')',
      },
      {
        topic: 'fsrs',
        front:
          'You could not recall the answer, but recognized it after revealing it. Again or Hard?',
        back:
          '**Again.** Recognizing an answer is different from recalling it.\n\n| Rating | Before revealing the answer |\n| --- | --- |\n| Again · 1 | Forgot or answered incorrectly |\n| Hard · 2 | Correct, with difficulty |\n| Good · 3 | Correct, with normal effort |\n| Easy · 4 | Correct, effortlessly |\n\nRate your recall, not the interval you would like. [Rating guide](' +
          ratings +
          ')',
      },
      {
        topic: 'repeaty',
        type: 'reversed',
        format: 'plain',
        front: 'Active recall',
        back: 'Retrieving an answer from memory before checking it',
      },
      {
        topic: 'repeaty',
        front: 'Why does the “Active recall” note produce two cards?',
        back: 'It is a **reversed note**: each direction asks a question and has its own review schedule.\n\nChoose “Reversed” when adding a card. By default, rating one card buries its sibling until tomorrow to avoid giving away the answer. You can change this in deck settings.',
      },
      {
        topic: 'fsrs',
        type: 'cloze',
        front:
          'A desired retention of 90% targets about a {{c1::90%::probability}} chance of recalling an answer when it is next due.',
        back:
          'It is a model target, not a guarantee that you know 90% of the deck.\n\nThis is a **cloze card**. Write `{{c1::90%::probability}}` in the editor to hide the answer and show a hint. [Desired retention](' +
          options +
          ')',
      },
      {
        topic: 'fsrs',
        front: 'What usually happens if you raise desired retention above 90%?',
        back:
          '**More frequent reviews and more work.**\n\nChange it in deck settings. Start with the default of 90% and see whether the daily workload is manageable. [Anki’s explanation](' +
          options +
          ')',
      },
      {
        topic: 'fsrs',
        front: 'What does retrievability (R) mean in FSRS?',
        back:
          '**The probability of recalling something right now.**\n\nWithout a review, R declines over time. It is an estimate; FSRS cannot observe your memory directly. [Memory state](' +
          fsrs +
          ')',
      },
      {
        topic: 'fsrs',
        front: 'What does a stability of S = 10 days mean?',
        back:
          'The model estimates that recall probability reaches 90% after 10 days.\n\n$$S = 10\\text{ days} \\quad \\Rightarrow \\quad R(10) = 0.9$$\n\nThis card also demonstrates math: use `$...$` inline or `$$...$$` for a separate formula. Actual due dates also depend on settings such as desired retention and learning steps. [Stability](' +
          fsrs +
          ')',
      },
      {
        topic: 'fsrs',
        media: 'curve',
        front: 'Which curve, A or B, represents a more stable memory?',
        back: '**B.** It declines more slowly and reaches the 90% line later.\n\nThese curves illustrate stability. They are not the FSRS formula or a personal prediction. Attach or paste an image on either side of a card to make your own visual questions.',
      },
      {
        topic: 'fsrs',
        front: 'Is FSRS difficulty (D) the same thing as pressing Hard?',
        back:
          '**No.** D is a per-card estimate that affects how stability grows after review. Hard rates your recall on this particular attempt.\n\nRatings affect the model, but do not pick one to force a particular D value. [Difficulty](' +
          fsrs +
          ')',
      },
      {
        topic: 'fsrs',
        front: 'After missing a few days, should you reset every card?',
        back: '**No. Resume reviewing and rate honestly.** FSRS considers the time that actually passed.\n\nRepeaty uses the default ts-fsrs parameters and updates each card’s state as you review. Training parameters on your personal history is not supported yet.',
      },
      {
        topic: 'repeaty',
        type: 'cloze',
        front:
          'Cloze deletions with the {{c1::same number}} hide together; {{c2::different numbers}} produce separate cards.',
        back: 'This note produces two cards.\n\n```text\n{{c1::same number}} … {{c2::different numbers}}\n```\n\nUse `c1` for several answers to hide them together. Nested clozes are not supported.',
      },
      {
        topic: 'repeaty',
        front:
          'What does this Python snippet print?\n\n```python\nintervals = [1, 3, 7]\nprint(sum(intervals))\n```',
        back: '**11**.\n\nThis demonstrates a code block, not the FSRS algorithm. Choose “Markdown / math” in the editor and put three backticks around code. Lists, tables and links work too.',
      },
      {
        topic: 'repeaty',
        media: 'tones',
        front: 'Play the two tones. Is the second higher or lower?',
        back: '**Higher.** The first is 440 Hz; the second is 880 Hz.\n\nThis original audio example was made for Repeaty. Attach pronunciation or listening exercises to either side of a card. If you cannot listen now, reveal the answer or bury the card for today.',
      },
      {
        topic: 'repeaty',
        front: 'How can you find just the FSRS questions in this deck?',
        back: 'Open “All cards” and search for `tag:fsrs`.\n\nThis deck uses the tags `starter`, `fsrs` and `repeaty`. Try `type:cloze` for cloze cards or combine conditions with `tag:fsrs is:new`. You can save searches you use often.',
      },
      {
        topic: 'repeaty',
        front: 'How can you browse these cards without changing their next review dates?',
        back: 'In the card list, expand “Advanced search, saved filters & focused practice” and choose **practice without updating the review schedule**.\n\nPractice the matching cards, reveal answers and rate them. Their existing review schedules stay unchanged.',
      },
      {
        topic: 'repeaty',
        front: 'You just pressed the wrong rating. How can you correct it?',
        back: 'Select **Undo last rating**, then answer again.\n\nUndo restores the previous schedule, including any sibling burial caused by that rating.',
      },
      {
        topic: 'repeaty',
        type: 'cloze',
        front:
          'To skip a card today, choose “{{c1::Bury today}}”. To stop reviewing it until you restore it manually, choose “{{c2::Suspend card}}”.',
        back: 'Burial ends the next day. Suspension lasts until you restore the card from the card list.\n\nBoth keep the content and review history; neither deletes the card.',
      },
      {
        topic: 'repeaty',
        front: 'Why might new cards stop appearing even though some remain?',
        back: 'You may have reached the **daily new-card limit**, or the remaining cards may be siblings buried today.\n\nCheck new-card limits, review limits and sibling burial in deck settings. This starter deck allows 30 new cards per day; other new decks default to 20.',
      },
      {
        topic: 'repeaty',
        front: 'Besides pressing Again, what can you do about a card you keep forgetting?',
        back: '**Make the question smaller and clearer.**\n\nReplace “Explain all of FSRS” with questions such as “What does R mean?” and “What unit is S measured in?”. Edit notes from the card list. Frequently forgotten cards are marked as leeches so you can find and revise them.',
      },
      {
        topic: 'repeaty',
        front:
          'How do you keep cards, images and audio before changing browsers or clearing site data?',
        back: '**Export a .repeaty backup** from “Data & backups” and keep the file outside the website. Restoring replaces the destination library after confirmation.\n\nThe static edition stores data in this browser; the server edition stores it in SQLite. Backups transfer between both. Automatic snapshots do not replace a separate backup.',
      },
      {
        topic: 'repeaty',
        front: 'Who installs plugins? Can the online edition submit to LeetCode?',
        back: '**The deployer installs plugins.** Users enable or disable them on the Plugins page. Disabling one keeps its questions and progress.\n\nFrontend plugins run in the browser; plugins that need a service use the server edition. The GitHub Pages edition does not include LeetCode. It is bundled with the server edition and needs connection settings.',
      },
      {
        topic: 'repeaty',
        front: 'How do you start making your own cards after this deck?',
        back:
          'Choose “Create deck” → “Add card”. Start with one clear question and a short answer. Existing tables can be imported as CSV / TSV.\n\nKeep, edit or delete this deck. It will not return automatically after deletion. You can add it again from “Data & backups” in the current interface language.\n\nRead more: [FSRS introduction](' +
          fsrs +
          ') · [Anki’s rating guide](' +
          ratings +
          ').',
      },
    ],
  },
}
