import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile/features/pisocamp/data/ar_downloads.dart';

/// AR-005. Downloading AR experiences so they work with no connection.
///
/// Per experience and all at once, because both are real requests: somebody on
/// a metered connection wants the one coin they are looking at, and somebody
/// about to travel wants the lot. What is already downloaded says so, and an
/// interrupted download says that rather than pretending to be absent — the
/// bytes are still there, and trying again continues from them.
class ArDownloadsScreen extends StatefulWidget {
  const ArDownloadsScreen({super.key, required this.manager});

  final ArDownloadManager manager;

  @override
  State<ArDownloadsScreen> createState() => _ArDownloadsScreenState();
}

class _ArDownloadsScreenState extends State<ArDownloadsScreen> {
  late List<ArDownloadItem> _items = widget.manager.items;
  StreamSubscription<List<ArDownloadItem>>? _changes;
  String? _failure;
  var _busy = false;

  @override
  void initState() {
    super.initState();
    _changes = widget.manager.changes.listen((items) {
      if (mounted) setState(() => _items = items);
    });
    unawaited(_refresh());
  }

  @override
  void dispose() {
    unawaited(_changes?.cancel());
    super.dispose();
  }

  Future<void> _refresh() async {
    await widget.manager.refresh();
    if (mounted) setState(() => _items = widget.manager.items);
  }

  Future<void> _run(Future<void> Function() work) async {
    setState(() {
      _busy = true;
      _failure = null;
    });
    try {
      await work();
    } on Object {
      // Said plainly, and without a technical code: what somebody can do about
      // it is try again, and the bytes already downloaded are not lost.
      if (mounted) {
        setState(
          () => _failure =
              'The download stopped before it finished. What arrived is kept — '
              'try again and it will carry on.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pending = _items.where(
      (item) => item.status != ArDownloadStatus.ready,
    );
    return Scaffold(
      appBar: AppBar(title: const Text('Augmented reality downloads')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            const Text(
              'Downloaded experiences open with no connection at all, including '
              'in airplane mode.',
            ),
            if (_failure != null) ...<Widget>[
              const SizedBox(height: 12),
              Semantics(
                liveRegion: true,
                child: Text(
                  _failure!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ],
            const SizedBox(height: 16),
            SizedBox(
              height: 48,
              child: FilledButton(
                onPressed: _busy || pending.isEmpty
                    ? null
                    : () => _run(widget.manager.downloadAll),
                child: Text(
                  pending.isEmpty
                      ? 'Everything is downloaded'
                      : 'Download all (${pending.length})',
                ),
              ),
            ),
            const SizedBox(height: 16),
            for (final item in _items) ...<Widget>[
              _ExperienceRow(
                item: item,
                busy: _busy,
                onDownload: () => _run(() => widget.manager.download(item.logicalId)),
              ),
              const Divider(),
            ],
          ],
        ),
      ),
    );
  }
}

class _ExperienceRow extends StatelessWidget {
  const _ExperienceRow({
    required this.item,
    required this.busy,
    required this.onDownload,
  });

  final ArDownloadItem item;
  final bool busy;
  final VoidCallback onDownload;

  String get _status => switch (item.status) {
    ArDownloadStatus.ready => 'Downloaded',
    ArDownloadStatus.downloading => 'Downloading…',
    ArDownloadStatus.interrupted => 'Partly downloaded',
    ArDownloadStatus.absent => 'Not downloaded',
  };

  @override
  Widget build(BuildContext context) {
    final progress = item.progress;
    return Semantics(
      // One label for the row, so a screen reader announces the experience and
      // where its download has got to together rather than as two fragments.
      label: '${item.title}. $_status.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(item.title, style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 4),
          Text(_status),
          if (item.status != ArDownloadStatus.ready && progress != null) ...<Widget>[
            const SizedBox(height: 8),
            LinearProgressIndicator(value: progress),
          ],
          const SizedBox(height: 8),
          SizedBox(
            height: 48,
            child: OutlinedButton(
              onPressed: busy || item.status == ArDownloadStatus.ready
                  ? null
                  : onDownload,
              child: Text(
                item.status == ArDownloadStatus.interrupted
                    ? 'Resume'
                    : 'Download',
              ),
            ),
          ),
        ],
      ),
    );
  }
}
