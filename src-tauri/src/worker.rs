use std::sync::{Arc, OnceLock};
use tokio::sync::Semaphore;

const BLOCKING_CAPACITY: usize = 16;

#[derive(Clone)]
pub struct BlockingWork {
    slots: Arc<Semaphore>,
}

impl BlockingWork {
    fn new(capacity: usize) -> Self {
        Self {
            slots: Arc::new(Semaphore::new(capacity)),
        }
    }

    pub async fn run<F, T>(&self, work: F) -> Result<T, tokio::task::JoinError>
    where
        F: FnOnce() -> T + Send + 'static,
        T: Send + 'static,
    {
        let permit = self.slots.clone().acquire_owned().await.unwrap();
        tokio::task::spawn_blocking(move || {
            // Cancellation of the caller must not free capacity while filesystem work still runs.
            let _permit = permit;
            work()
        })
        .await
    }
}

pub fn blocking_work() -> &'static BlockingWork {
    static WORK: OnceLock<BlockingWork> = OnceLock::new();
    WORK.get_or_init(|| BlockingWork::new(BLOCKING_CAPACITY))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn cancelled_caller_keeps_capacity_until_worker_finishes() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let gate = BlockingWork::new(1);
            let first_gate = gate.clone();
            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let first = tokio::spawn(async move {
                first_gate
                    .run(move || {
                        started_tx.send(()).unwrap();
                        release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                    })
                    .await
            });
            tokio::time::timeout(Duration::from_secs(2), started_rx)
                .await
                .unwrap()
                .unwrap();
            first.abort();
            assert!(first.await.unwrap_err().is_cancelled());
            assert_eq!(gate.slots.available_permits(), 0);
            let (second_tx, mut second_rx) = tokio::sync::oneshot::channel();
            let second = tokio::spawn(async move {
                gate.run(move || second_tx.send(()).unwrap()).await.unwrap();
            });
            assert!(
                tokio::time::timeout(Duration::from_millis(30), &mut second_rx)
                    .await
                    .is_err()
            );
            release_tx.send(()).unwrap();
            tokio::time::timeout(Duration::from_secs(2), second_rx)
                .await
                .unwrap()
                .unwrap();
            second.await.unwrap();
        });
    }

    #[test]
    fn timed_out_caller_keeps_capacity_until_worker_finishes() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let gate = BlockingWork::new(1);
            let (started_tx, started_rx) = tokio::sync::oneshot::channel();
            let (release_tx, release_rx) = mpsc::channel();
            let mut work = Box::pin(gate.run(move || {
                started_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            }));
            let mut started_rx = started_rx;
            tokio::time::timeout(
                Duration::from_secs(2),
                std::future::poll_fn(|cx| {
                    use std::future::Future;
                    assert!(work.as_mut().poll(cx).is_pending());
                    std::pin::Pin::new(&mut started_rx).poll(cx)
                }),
            )
            .await
            .unwrap()
            .unwrap();
            assert!(
                tokio::time::timeout(Duration::from_millis(30), &mut work)
                    .await
                    .is_err()
            );
            drop(work);
            assert_eq!(gate.slots.available_permits(), 0);
            release_tx.send(()).unwrap();
            tokio::time::timeout(Duration::from_secs(2), gate.run(|| 42))
                .await
                .unwrap()
                .unwrap();
            assert_eq!(gate.slots.available_permits(), 1);
        });
    }

    #[test]
    fn worker_panic_releases_capacity() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        runtime.block_on(async {
            let gate = BlockingWork::new(1);
            assert!(
                gate.run(|| panic!("worker failed"))
                    .await
                    .unwrap_err()
                    .is_panic()
            );
            assert_eq!(gate.run(|| 42).await.unwrap(), 42);
        });
    }
}
