"""Original teaching illustration; the curves are schematic, not the FSRS formula.

Regenerate with Python, matplotlib and numpy. Large labels remain readable on phones.
"""
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
    ax.plot(x, 100 * .9 ** (x / stability), color=color, lw=5)
    ax.text(42, 100 * .9 ** (40 / stability), label, color=color, fontsize=44, va='center', weight='bold')
ax.axhline(90, color='#81877c', ls='--', lw=2)
ax.text(34, 92, '90%', color='#62685e', fontsize=36)
ax.set(xlim=(0, 48), ylim=(60, 102))
ax.set_xlabel('t', loc='right', fontsize=38, color='#62685e')
ax.text(-.085, .91, 'R', transform=ax.transAxes, fontsize=38, color='#62685e', va='center', ha='center')
ax.set_xticks([])
ax.set_yticks([])
ax.spines[['top', 'right']].set_visible(False)
ax.spines[['left', 'bottom']].set_color('#bdc6b8')
fig.subplots_adjust(left=.12, bottom=.19, top=.95, right=.97)
fig.savefig(Path(__file__).resolve().parents[1] / 'src/core/starter/recall.png', metadata={'Software': 'Repeaty'})
