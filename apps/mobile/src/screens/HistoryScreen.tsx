import { useCallback, useEffect, useState } from "react";
import {
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Banner, Button, Card, Eyebrow, Icon, Pill, ProgressBar } from "../components/ui";
import { config, explorer } from "../config";
import type { History, HistoryItem, SeenitApi } from "../lib/api";
import { formatReward, shortAddress, shortHash } from "../lib/format";
import { verificationErrorMessage } from "../lib/messages";
import type { QueueItem } from "../lib/upload-queue";
import { colors, radius, space, type } from "../theme";
import { queueStateLabel, submissionStatusLabel } from "./status";

/** Earnings, pending uploads and every submission with its on-chain receipts. */
export function HistoryScreen({
  api,
  queue,
  online,
  needsSignIn = false,
  onRetry,
  onRemove,
  onClearDone,
  onSignOut,
  openUrl = Linking.openURL,
}: {
  api: Pick<SeenitApi, "getHistory">;
  queue: readonly QueueItem[];
  online: boolean;
  needsSignIn?: boolean;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onClearDone: () => void;
  onSignOut?: () => void;
  openUrl?: (url: string) => Promise<unknown>;
}) {
  const insets = useSafeAreaInsets();
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setHistory(await api.getHistory());
      setError(null);
    } catch (e) {
      setError(verificationErrorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }, [api]);

  // Refresh when an upload finishes so its submission appears in the list.
  const doneCount = queue.filter((q) => q.state === "done").length;
  useEffect(() => {
    let cancelled = false;
    api.getHistory().then(
      (h) => {
        if (cancelled) return;
        setHistory(h);
        setError(null);
      },
      (e) => !cancelled && setError(verificationErrorMessage(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [api, doneCount]);

  const decimals = history?.summary.token.decimals ?? config.tokenDecimals;
  const symbol = history?.summary.token.symbol ?? config.tokenSymbol;
  // Queue items that already became a server submission are shown in the history list instead.
  const known = new Set(history?.items.map((i) => i.id));
  const pendingUploads = queue.filter(
    (q) => !(q.state === "done" && q.submissionId && known.has(q.submissionId)),
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + 100 },
      ]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={load} />}
    >
      <Text style={type.title}>Earnings</Text>

      <View style={styles.balance} accessibilityLabel="Reward balance">
        <Text style={styles.balanceLabel}>EARNED</Text>
        <Text style={styles.balanceValue} testID="earned">
          {history ? formatReward(history.summary.earned, decimals, symbol) : "—"}
        </Text>
        <Text style={styles.balanceSub}>
          {history
            ? `${formatReward(history.summary.pending, decimals, symbol)} in review · paid to ${shortAddress(history.wallet)}`
            : "Loading…"}
        </Text>
        {history ? (
          <View style={styles.counts}>
            <Pill label={`${history.summary.accepted} accepted`} tone="lime" />
            <Pill label={`${history.summary.inReview} processing`} tone="ink" />
            <Pill label={`${history.summary.rejected} rejected`} tone="ink" />
          </View>
        ) : null}
        {history ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="View wallet on explorer"
            onPress={() => openUrl(explorer.address(history.wallet))}
            style={styles.linkRow}
          >
            <Icon name="link" size={14} color={colors.lime} />
            <Text style={styles.linkLight}>View wallet on explorer</Text>
          </Pressable>
        ) : null}
      </View>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {needsSignIn ? (
        <Banner tone="warn">Your session expired. Sign in again to resume uploads.</Banner>
      ) : null}

      {pendingUploads.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Eyebrow>Uploads</Eyebrow>
            {!online ? <Pill label="Offline" tone="warn" /> : null}
            {pendingUploads.some((q) => q.state === "done" || q.state === "rejected") ? (
              <Pressable accessibilityRole="button" onPress={onClearDone}>
                <Text style={styles.clear}>Clear finished</Text>
              </Pressable>
            ) : null}
          </View>
          {pendingUploads.map((q) => (
            <UploadRow key={q.id} item={q} online={online} onRetry={onRetry} onRemove={onRemove} />
          ))}
        </View>
      ) : null}

      <View style={styles.section}>
        <Eyebrow>Submissions</Eyebrow>
        {history && history.items.length === 0 ? (
          <Text style={type.muted}>No submissions yet. Pick a mission nearby to get started.</Text>
        ) : null}
        {history?.items.map((item) => (
          <SubmissionRow
            key={item.id}
            item={item}
            decimals={decimals}
            symbol={symbol}
            openUrl={openUrl}
          />
        ))}
      </View>

      {onSignOut ? <Button label="Sign out" variant="ghost" onPress={onSignOut} /> : null}
    </ScrollView>
  );
}

function UploadRow({
  item: q,
  online,
  onRetry,
  onRemove,
}: {
  item: QueueItem;
  online: boolean;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const s = queueStateLabel(q.state, online);
  const canRetry = q.state === "failed" || (q.state === "queued" && q.attempts > 0);
  const canRemove = q.state === "failed" || q.state === "rejected";
  return (
    <Card>
      <View style={styles.rowTop}>
        <Text style={[type.body, styles.bold, styles.flex]} numberOfLines={1}>
          {q.missionTitle}
        </Text>
        <Pill label={s.label} tone={s.tone} />
      </View>
      {q.state === "uploading" ? (
        <ProgressBar value={q.progress} label={`Uploading ${q.missionTitle}`} />
      ) : null}
      {q.lastError && q.state !== "done" ? <Text style={type.small}>{q.lastError}</Text> : null}
      {q.state === "queued" && q.attempts > 0 ? (
        <Text style={type.small}>{`Attempt ${q.attempts + 1}. Retrying automatically.`}</Text>
      ) : null}
      {canRetry || canRemove ? (
        <View style={styles.actions}>
          {canRetry ? (
            <Button label="Retry now" variant="secondary" onPress={() => onRetry(q.id)} />
          ) : null}
          {canRemove ? (
            <Button label="Remove" variant="ghost" onPress={() => onRemove(q.id)} />
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function SubmissionRow({
  item,
  decimals,
  symbol,
  openUrl,
}: {
  item: HistoryItem;
  decimals: number;
  symbol: string;
  openUrl: (url: string) => Promise<unknown>;
}) {
  const s = submissionStatusLabel(item.status);
  const links: { label: string; hash: string }[] = [];
  if (item.recordTxHash) links.push({ label: "Recorded", hash: item.recordTxHash });
  if (item.payout?.txHash) links.push({ label: "Paid", hash: item.payout.txHash });
  else if (item.resolveTxHash) links.push({ label: "Resolved", hash: item.resolveTxHash });

  return (
    <Card>
      <View style={styles.rowTop}>
        <Text style={[type.body, styles.bold, styles.flex]} numberOfLines={2}>
          {item.mission.title}
        </Text>
        <Pill label={s.label} tone={s.tone} />
      </View>
      <Text style={type.small}>
        {`${new Date(item.capturedAt ?? item.createdAt).toLocaleString()} · ${item.mediaType === "video" ? "Video" : "Photo"}`}
      </Text>
      <Text style={type.body}>
        {item.payout
          ? `+${formatReward(item.payout.amount, decimals, symbol)}`
          : `${formatReward(item.mission.reward, decimals, symbol)} reward`}
      </Text>
      {item.status === "rejected" || item.status === "rejected_precheck" ? (
        item.rejectionReasons?.length ? (
          <Text style={[type.small, { color: colors.danger }]}>
            {item.rejectionReasons.join(", ").replaceAll("_", " ")}
          </Text>
        ) : null
      ) : null}
      {links.map((l) => (
        <Pressable
          key={l.hash}
          accessibilityRole="link"
          accessibilityLabel={`${l.label} transaction on explorer`}
          onPress={() => openUrl(explorer.tx(l.hash))}
          style={styles.linkRow}
        >
          <Icon name="link" size={14} color={colors.verify} />
          <Text style={styles.link}>{`${l.label} · ${shortHash(l.hash)}`}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { paddingHorizontal: space.xl, gap: space.lg },
  balance: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: space.sm,
  },
  balanceLabel: { color: colors.lime, fontSize: 12, letterSpacing: 1.4, fontWeight: "600" },
  balanceValue: { color: colors.paper, fontSize: 34, fontWeight: "700", letterSpacing: -0.5 },
  balanceSub: { color: "#c9ccd1", fontSize: 14 },
  counts: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: space.xs },
  section: { gap: space.md },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: space.sm },
  clear: { color: colors.muted, fontSize: 13, textDecorationLine: "underline" },
  rowTop: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  flex: { flex: 1 },
  bold: { fontWeight: "600" },
  actions: { flexDirection: "row", gap: space.sm },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  link: { color: colors.verify, fontWeight: "600", fontSize: 13 },
  linkLight: { color: colors.lime, fontWeight: "600", fontSize: 13 },
});
