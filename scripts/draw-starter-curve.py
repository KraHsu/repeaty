"""Original teaching illustration; the curves are schematic, not the FSRS formula."""
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np

x = np.linspace(0, 40, 240)
fig, ax = plt.subplots(figsize=(8, 3.8), dpi=140)
fig.patch.set_facecolor('#fafbf7')
ax.set_facecolor('#fafbf7')
for stability, color, label in [(10, '#a77a50', 'A'), (30, '#37634b', 'B')]:
    ax.plot(x, 100 * .9 ** (x / stability), color=color, lw=3, label=label)
ax.axhline(90, color='#81877c', ls='--', lw=1)
ax.text(39, 90.8, '90%', ha='right', color='#62685e')
ax.set(xlim=(0, 40), ylim=(60, 102), xlabel='Time since review', ylabel='Recall probability (%)')
ax.set_xticks([])
ax.set_yticks([60, 70, 80, 90, 100])
ax.spines[['top', 'right']].set_visible(False)
ax.spines[['left', 'bottom']].set_color('#bdc6b8')
ax.tick_params(colors='#62685e')
ax.legend(frameon=False, loc='lower left', ncol=2)
fig.text(.5, .025, 'Illustration only — not an FSRS prediction', ha='center', color='#62685e', fontsize=9)
fig.tight_layout(rect=(0, .055, 1, 1))
fig.savefig(Path(__file__).resolve().parents[1] / 'src/core/starter/recall.png', metadata={'Software': 'Repeaty'})
