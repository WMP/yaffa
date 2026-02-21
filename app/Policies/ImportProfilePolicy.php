<?php

namespace App\Policies;

use App\Models\ImportProfile;
use App\Models\User;
use Illuminate\Auth\Access\HandlesAuthorization;

class ImportProfilePolicy
{
    use HandlesAuthorization;

    public function isOwnItem(User $user, ImportProfile $importProfile): bool
    {
        return $user->id === $importProfile->user_id;
    }

    /**
     * Determine whether the user can view any models.
     */
    public function viewAny(User $user): bool
    {
        return true;
    }

    /**
     * Determine whether the user can view the model.
     */
    public function view(User $user, ImportProfile $importProfile): bool
    {
        return $this->isOwnItem($user, $importProfile);
    }

    /**
     * Determine whether the user can create models.
     */
    public function create(User $user): bool
    {
        return true;
    }

    /**
     * Determine whether the user can update the model.
     */
    public function update(User $user, ImportProfile $importProfile): bool
    {
        return $this->isOwnItem($user, $importProfile);
    }

    /**
     * Determine whether the user can delete the model.
     */
    public function delete(User $user, ImportProfile $importProfile): bool
    {
        return $this->isOwnItem($user, $importProfile);
    }
}
