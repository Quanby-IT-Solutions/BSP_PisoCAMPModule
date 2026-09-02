import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mobile/features/pisocamp/data/preview_build.dart';
import 'package:mobile/features/pisocamp/data/preview_repository.dart';
import 'package:mobile/services/api/api_client.dart';

/// CM-5 preview renderer for a BSP-approved preview build.
///
/// Renders one pre-publication version from a scanned or pasted grant. The
/// document and its bytes live only in this widget's state: nothing is written
/// to the bundle store, secure storage or the file system, so a previewed
/// version can never be mistaken for published content.
class PisoCampPreviewScreen extends ConsumerStatefulWidget {
  const PisoCampPreviewScreen({super.key, this.initialCode});

  final String? initialCode;

  @override
  ConsumerState<PisoCampPreviewScreen> createState() =>
      _PisoCampPreviewScreenState();
}

class _PisoCampPreviewScreenState extends ConsumerState<PisoCampPreviewScreen> {
  late final TextEditingController _codeController;
  String? _token;
  String? _codeError;
  Future<PisoCampPreviewDocument>? _document;

  @override
  void initState() {
    super.initState();
    _codeController = TextEditingController(text: widget.initialCode ?? '');
    final initial = widget.initialCode;
    if (kPisoCampPreviewBuild && initial != null) _render(initial);
  }

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  PisoCampPreviewRepository get _repository =>
      PisoCampPreviewRepository(ref.read(dioProvider));

  void _render(String code) {
    // Second gate, deliberately duplicated: a store build must never reach the
    // network for unapproved content, whatever calls this.
    if (!kPisoCampPreviewBuild) return;
    final token = readPisoCampPreviewToken(code);
    if (token == null) {
      setState(() {
        _codeError = 'That preview code is not valid. Scan or paste it again.';
        _token = null;
        _document = null;
      });
      return;
    }
    // One fetch per code. Rebuilds reuse this future, so a rendered preview is
    // never silently refetched or refreshed behind the reviewer.
    setState(() {
      _codeError = null;
      _token = token;
      _document = _repository.load(token);
    });
  }

  @override
  Widget build(BuildContext context) {
    if (!kPisoCampPreviewBuild) {
      return Scaffold(
        appBar: AppBar(title: const Text('Preview')),
        body: const SafeArea(
          child: Center(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Text(
                'Content preview is available only in a BSP-approved preview build.',
                textAlign: TextAlign.center,
              ),
            ),
          ),
        ),
      );
    }

    final token = _token;
    final document = _document;
    return Scaffold(
      appBar: AppBar(title: const Text('Content preview')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const _PreviewNotice(),
              const SizedBox(height: 16),
              TextField(
                controller: _codeController,
                maxLines: 2,
                minLines: 1,
                autocorrect: false,
                enableSuggestions: false,
                decoration: InputDecoration(
                  labelText: 'Preview code',
                  helperText: 'Scan the code in the admin console, then paste it here.',
                  errorText: _codeError,
                  border: const OutlineInputBorder(),
                ),
                onSubmitted: _render,
              ),
              const SizedBox(height: 12),
              ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 48),
                child: FilledButton(
                  onPressed: () => _render(_codeController.text),
                  child: const Text('Render preview'),
                ),
              ),
              const SizedBox(height: 24),
              if (document == null || token == null)
                const Text('Enter a preview code to render an unpublished version.')
              else
                FutureBuilder<PisoCampPreviewDocument>(
                  future: document,
                  builder: (context, snapshot) {
                    if (snapshot.connectionState != ConnectionState.done) {
                      return const Center(child: Text('Loading preview…'));
                    }
                    final error = snapshot.error;
                    if (error != null || snapshot.data == null) {
                      return _PreviewUnavailable(
                        code: error is PisoCampPreviewException
                            ? error.code
                            : 'preview_unavailable',
                      );
                    }
                    return _PreviewBody(
                      document: snapshot.data!,
                      token: token,
                      repository: _repository,
                    );
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PreviewNotice extends StatelessWidget {
  const _PreviewNotice();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Preview only — not published',
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              const Text(
                'This version has not been approved for the public. It is shown '
                'once from the preview code and is never saved to your offline '
                'content.',
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PreviewUnavailable extends StatelessWidget {
  const _PreviewUnavailable({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    final message = switch (code) {
      'expired_preview' =>
        'This preview code has expired or was withdrawn. Generate a new one.',
      'preview_asset_mismatch' =>
        'A preview file did not match its checksum and was not shown.',
      _ => 'The preview could not be loaded. Check the code and your connection.',
    };
    return Semantics(
      liveRegion: true,
      child: Text(message, style: Theme.of(context).textTheme.bodyLarge),
    );
  }
}

class _PreviewBody extends StatelessWidget {
  const _PreviewBody({
    required this.document,
    required this.token,
    required this.repository,
  });

  final PisoCampPreviewDocument document;
  final String token;
  final PisoCampPreviewRepository repository;

  @override
  Widget build(BuildContext context) {
    final images = document.assets.where((asset) => asset.isImage).toList();
    return SelectionArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            header: true,
            child: Text(
              document.title,
              style: Theme.of(context).textTheme.headlineSmall,
            ),
          ),
          const SizedBox(height: 4),
          Text('Version ${document.versionNo} · ${document.status}'),
          const SizedBox(height: 8),
          Text(document.summary, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 16),
          for (final asset in images) ...[
            _PreviewImage(
              asset: asset,
              token: token,
              repository: repository,
              title: document.title,
            ),
            const SizedBox(height: 16),
          ],
          if (document.body != null) Text(document.body!),
          if (document.relatedLinks.isNotEmpty) ...[
            const SizedBox(height: 24),
            Semantics(
              header: true,
              child: Text(
                'Related information',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            for (final link in document.relatedLinks)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        link.label,
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 4),
                      Text(link.detail, softWrap: true),
                    ],
                  ),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _PreviewImage extends StatefulWidget {
  const _PreviewImage({
    required this.asset,
    required this.token,
    required this.repository,
    required this.title,
  });

  final PisoCampPreviewAsset asset;
  final String token;
  final PisoCampPreviewRepository repository;
  final String title;

  @override
  State<_PreviewImage> createState() => _PreviewImageState();
}

class _PreviewImageState extends State<_PreviewImage> {
  late final Future<Uint8List> _bytes;

  @override
  void initState() {
    super.initState();
    _bytes = widget.repository.loadAsset(widget.token, widget.asset);
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List>(
      future: _bytes,
      builder: (context, snapshot) {
        final bytes = snapshot.data;
        if (bytes == null) return const SizedBox.shrink();
        return Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 600),
            child: Semantics(
              container: true,
              image: true,
              label: '${widget.asset.role} image of ${widget.title}',
              child: ExcludeSemantics(
                child: Image.memory(
                  bytes,
                  fit: BoxFit.contain,
                  gaplessPlayback: true,
                  errorBuilder: (context, error, stackTrace) =>
                      const SizedBox.shrink(),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
