import Foundation

public extension CloudAccount {
    func credentialIdentityChanged(from previous: CloudAccount) -> Bool {
        provider != previous.provider || endpoint != previous.endpoint
    }
}
