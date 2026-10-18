import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

def generate_report(csv_file, output_image):
    try:
        df = pd.read_csv(csv_file)
    except FileNotFoundError:
        print(f"Error: Could not find {csv_file}")
        return

    # Create figure with 4 subplots
    fig, axs = plt.subplots(2, 2, figsize=(16, 12))
    fig.suptitle('Mimo Bot Stress Test & Chaos Engineering Report', fontsize=18, fontweight='bold')

    # Panel 1: Memory (RAM RSS & Heap) vs. Time
    ax1 = axs[0, 0]
    # We want X-axis to be elapsed time in seconds, colored by user load, but simplified:
    df['Elapsed_Seconds'] = df['Timestamp'] - df['Timestamp'].iloc[0]

    ax1.plot(df['Elapsed_Seconds'], df['MemHeapMB'], label='Heap Allocated (MB)', color='blue', linewidth=2)
    ax1.plot(df['Elapsed_Seconds'], df['MemRSSMB'], label='RSS (MB)', color='purple', linewidth=2)

    # User load annotations
    for tier in df['Users'].unique():
        tier_data = df[df['Users'] == tier]
        if not tier_data.empty:
            start_x = tier_data['Elapsed_Seconds'].iloc[0]
            ax1.axvline(x=start_x, color='gray', linestyle='--', alpha=0.5)
            ax1.text(start_x + 1, ax1.get_ylim()[1] * 0.9, f'{tier} Users', rotation=90, verticalalignment='top')

    # Thresholds
    ax1.axhline(y=100, color='orange', linestyle='--', label='100MB (Go Target Limit)')
    ax1.axhline(y=256, color='red', linestyle='-', linewidth=2, label='256MB (Server Hard Limit)')

    ax1.set_title('Memory (RAM RSS & Heap) vs. Time & User Load')
    ax1.set_xlabel('Elapsed Time (seconds)')
    ax1.set_ylabel('Memory Usage (MB)')
    ax1.legend()
    ax1.grid(True, alpha=0.3)

    # Panel 2: Latency Percentiles vs. Concurrency
    ax2 = axs[0, 1]

    # Calculate average latencies per user tier
    tier_means = df.groupby('Users')[['P50LatMs', 'P95LatMs', 'P99LatMs']].mean().reset_index()

    ax2.plot(tier_means['Users'], tier_means['P50LatMs'], marker='o', label='p50 Latency', color='green')
    ax2.plot(tier_means['Users'], tier_means['P95LatMs'], marker='s', label='p95 Latency', color='orange')
    ax2.plot(tier_means['Users'], tier_means['P99LatMs'], marker='^', label='p99 Latency', color='red')

    ax2.set_title('Latency Percentiles vs. Concurrency')
    ax2.set_xlabel('Concurrent Virtual Users')
    ax2.set_ylabel('Latency (ms)')
    ax2.set_xticks(tier_means['Users'])
    ax2.legend()
    ax2.grid(True, alpha=0.3)

    # Panel 3: Request Throughput & Outcome Breakdown
    ax3 = axs[1, 0]

    # Calculate per-second rates (diff)
    df['Success_Diff'] = df['Success'].diff().fillna(0)
    df['CacheHits_Diff'] = df['CacheHits'].diff().fillna(0)
    df['QueueWait_Diff'] = df['QueueWait'].diff().fillna(0)
    df['RateLimited_Diff'] = df['RateLimited'].diff().fillna(0)
    df['SSRFBlocked_Diff'] = df['SSRFBlocked'].diff().fillna(0)

    # Stacked area chart
    ax3.stackplot(df['Elapsed_Seconds'],
                  df['Success_Diff'],
                  df['CacheHits_Diff'],
                  df['QueueWait_Diff'],
                  df['RateLimited_Diff'],
                  df['SSRFBlocked_Diff'],
                  labels=['Successful Deliveries', 'Instant Cache-Hits', 'Queue Dispatched', 'Rate-Limited (429)', 'SSRF / Security Blocked'],
                  colors=['#2ca02c', '#1f77b4', '#9467bd', '#ff7f0e', '#d62728'],
                  alpha=0.8)

    ax3.set_title('Request Throughput & Outcome Breakdown')
    ax3.set_xlabel('Elapsed Time (seconds)')
    ax3.set_ylabel('Requests / Second')
    ax3.legend(loc='upper left')
    ax3.grid(True, alpha=0.3)

    # Panel 4: SQLite WAL Operations/sec & Disk Oscillation
    ax4 = axs[1, 1]

    color_read = 'tab:blue'
    color_write = 'tab:orange'
    color_disk = 'tab:green'

    # Primary axis for DB ops
    ax4.plot(df['Elapsed_Seconds'], df['DBReadOps'], label='DB Read Ops/s', color=color_read, linestyle='-', linewidth=2)
    ax4.plot(df['Elapsed_Seconds'], df['DBWriteOps'], label='DB Write Ops/s', color=color_write, linestyle='-', linewidth=2)

    ax4.set_xlabel('Elapsed Time (seconds)')
    ax4.set_ylabel('SQLite Transactions / Second', color='black')
    ax4.tick_params(axis='y', labelcolor='black')
    ax4.legend(loc='upper left')

    # Secondary axis for Disk Temp
    ax4_twin = ax4.twinx()
    ax4_twin.plot(df['Elapsed_Seconds'], df['DiskTempMB'], label='Temp Disk Alloc (MB)', color=color_disk, linestyle='--', linewidth=2)
    ax4_twin.set_ylabel('Temporary Disk Allocation (MB)', color=color_disk)
    ax4_twin.tick_params(axis='y', labelcolor=color_disk)
    ax4_twin.legend(loc='upper right')

    ax4.set_title('SQLite WAL Operations/sec & Disk Oscillation')
    ax4.grid(True, alpha=0.3)

    # Save and display
    plt.tight_layout(rect=[0, 0.03, 1, 0.95])
    plt.savefig(output_image, dpi=300, bbox_inches='tight')
    print(f"Report successfully saved to {output_image}")

if __name__ == '__main__':
    generate_report('stress_metrics.csv', 'stress_test_report.png')
