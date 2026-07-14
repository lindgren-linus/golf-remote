using System.Windows.Forms;

namespace GolfRemote.Agent.Windows;

public interface IPairingApproval
{
    Task<bool> RequestAsync(string clientName, CancellationToken cancellationToken);
}

public sealed class WindowsPairingApproval : IPairingApproval
{
    public Task<bool> RequestAsync(string clientName, CancellationToken cancellationToken)
    {
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                var result = MessageBox.Show(
                    $"Tillåt parkoppling från \"{clientName}\"?\n\nEnheten kan därefter styra mus och tangentbord på denna dator.",
                    "Golf Remote – parkoppling",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2);
                completion.TrySetResult(result == DialogResult.Yes);
            }
            catch (Exception exception)
            {
                completion.TrySetException(exception);
            }
        }) { IsBackground = true };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        return cancellationToken.CanBeCanceled
            ? completion.Task.WaitAsync(cancellationToken)
            : completion.Task;
    }
}

