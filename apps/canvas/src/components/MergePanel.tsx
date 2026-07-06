interface MergePanelProps {
  selectedNodeNames: string[];
  mergePrompt: string;
  onMergePromptChange: (prompt: string) => void;
  onStartMerge: () => void;
}

export function MergePanel({
  selectedNodeNames,
  mergePrompt,
  onMergePromptChange,
  onStartMerge
}: MergePanelProps) {
  const canMerge = selectedNodeNames.length > 1 && mergePrompt.trim().length > 0;

  return (
    <div className="prompt-box" aria-label="合并选中版本">
      <label htmlFor="merge-prompt">合并要求</label>
      <p className="panel-copy">
        已选择 {selectedNodeNames.length} 个版本：{" "}
        {selectedNodeNames.join(", ")}
      </p>
      <textarea
        id="merge-prompt"
        value={mergePrompt}
        placeholder="描述这些图片应该如何组合生成，例如：让人物自然抱着小猫坐在客厅看电视"
        onChange={(event) => onMergePromptChange(event.currentTarget.value)}
      />
      <button
        className="primary-button"
        type="button"
        disabled={!canMerge}
        onClick={onStartMerge}
      >
        开始合并
      </button>
    </div>
  );
}
