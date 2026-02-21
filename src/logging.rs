use tracing_subscriber::fmt::MakeWriter;

#[derive(Clone)]
pub(crate) struct SseMakeWriter {
    pub sender: tokio::sync::broadcast::Sender<String>,
    pub suppress_stdout: bool,
}

impl<'a> MakeWriter<'a> for SseMakeWriter {
    type Writer = SseWriter;

    fn make_writer(&'a self) -> Self::Writer {
        SseWriter {
            sender: self.sender.clone(),
            suppress_stdout: self.suppress_stdout,
        }
    }
}

pub(crate) struct SseWriter {
    sender: tokio::sync::broadcast::Sender<String>,
    suppress_stdout: bool,
}

impl std::io::Write for SseWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let msg = String::from_utf8_lossy(buf).to_string();
        let _ = self.sender.send(msg); // Ignored if no receivers
        if !self.suppress_stdout {
            std::io::stdout().write(buf)?;
        }
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        if !self.suppress_stdout {
            std::io::stdout().flush()?;
        }
        Ok(())
    }
}
